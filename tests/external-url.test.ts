import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.MUSIC_EXTERNAL_HOSTS = '127.0.0.1,192.168.1.1';

const { clients, lookup, undiciFetch } = vi.hoisted(() => {
  const clients: Array<{
    close: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    options: { connect?: { autoSelectFamily?: boolean } };
  }> = [];
  return { clients, lookup: vi.fn(), undiciFetch: vi.fn() };
});
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('undici', () => ({
  Client: class {
    close = vi.fn().mockResolvedValue(null);
    destroy = vi.fn();

    constructor(_origin: string, options: { connect?: { autoSelectFamily?: boolean } }) {
      this.options = options;
      clients.push(this);
    }

    options!: { connect?: { autoSelectFamily?: boolean } };
  },
  fetch: undiciFetch,
}));

const { fetchExternal, validateExternalUrl } = await import('../server/utils/external-url');

beforeEach(() => {
  lookup.mockImplementation(async (hostname: string) => [{ address: hostname, family: 4 }]);
});

afterEach(() => {
  clients.splice(0);
  lookup.mockReset();
  undiciFetch.mockReset();
});

describe('外部地址校验', () => {
  it('拒绝回环和私有地址', async () => {
    await expect(validateExternalUrl('http://127.0.0.1/')).rejects.toMatchObject({
      code: 'BAD_URL',
    });
    await expect(validateExternalUrl('http://192.168.1.1/')).rejects.toMatchObject({
      code: 'BAD_URL',
    });
    await expect(validateExternalUrl('http://127.0.0.1/', ['127.0.0.1'])).rejects.toMatchObject({
      code: 'BAD_URL',
    });
  });

  it('拒绝非 HTTP 协议', async () => {
    await expect(validateExternalUrl('file:///etc/passwd')).rejects.toMatchObject({
      code: 'BAD_URL',
    });
  });

  it('拒绝 DNS 同时解析到公网和私网的主机', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(
      fetchExternal('https://music.example.test/', {}, ['music.example.test'])
    ).rejects.toMatchObject({
      code: 'BAD_URL',
    });
  });

  it('逐跳手动验证跨源重定向', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    undiciFetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.test/audio.mp3' },
        })
      )
      .mockResolvedValueOnce(new Response('audio', { status: 200 }));

    await expect(
      fetchExternal('https://music.example.test/search', {}, [
        'music.example.test',
        'cdn.example.test',
      ])
    ).resolves.toMatchObject({ status: 200 });

    expect(undiciFetch).toHaveBeenCalledTimes(2);
    expect(undiciFetch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ href: 'https://music.example.test/search' })
    );
    expect(undiciFetch.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ href: 'https://cdn.example.test/audio.mp3' })
    );
    expect(undiciFetch.mock.calls).toEqual(
      expect.arrayContaining([[expect.any(URL), expect.objectContaining({ redirect: 'manual' })]])
    );
  });

  it('接受全球单播 IPv6 地址', async () => {
    lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
    await expect(
      validateExternalUrl('https://music.example.test/', ['music.example.test'])
    ).resolves.toBeInstanceOf(URL);
  });

  it.each([
    ['198.18.0.1', 4],
    ['192.0.0.8', 4],
    ['224.0.0.1', 4],
    ['fe90::1', 6],
    ['fec0::1', 6],
    ['ff02::1', 6],
    ['2001:db8::1', 6],
    ['3fff::1', 6],
    ['5f00::1', 6],
  ])('拒绝非全局可路由地址 %s', async (address, family) => {
    lookup.mockResolvedValue([{ address, family }]);
    await expect(
      validateExternalUrl('https://music.example.test/', ['music.example.test'])
    ).rejects.toMatchObject({
      code: 'BAD_URL',
    });
  });

  it('为固定地址连接禁用自动协议族选择', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    undiciFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await fetchExternal('https://music.example.test/', {}, ['music.example.test']);
    await response.text();

    expect(clients.at(-1)?.options.connect?.autoSelectFamily).toBe(false);
  });

  it('在响应体读取完成、取消或请求失败后关闭固定连接客户端', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    undiciFetch.mockResolvedValueOnce(new Response('audio', { status: 200 }));

    const completed = await fetchExternal('https://music.example.test/', {}, [
      'music.example.test',
    ]);
    const completedClient = clients.at(-1);
    expect(completedClient?.close).not.toHaveBeenCalled();
    await completed.text();
    expect(completedClient?.close).toHaveBeenCalledTimes(1);

    undiciFetch.mockResolvedValueOnce(new Response('audio', { status: 200 }));
    const cancelled = await fetchExternal('https://music.example.test/', {}, [
      'music.example.test',
    ]);
    const cancelledClient = clients.at(-1);
    await cancelled.body?.cancel();
    expect(cancelledClient?.close).toHaveBeenCalledTimes(1);

    undiciFetch.mockResolvedValueOnce(new Response('upstream error', { status: 502 }));
    const failed = await fetchExternal('https://music.example.test/', {}, ['music.example.test']);
    const failedClient = clients.at(-1);
    expect(failedClient?.close).not.toHaveBeenCalled();
    await failed.body?.cancel();
    expect(failedClient?.close).toHaveBeenCalledTimes(1);

    undiciFetch.mockRejectedValueOnce(new Error('upstream unavailable'));
    await expect(
      fetchExternal('https://music.example.test/', {}, ['music.example.test'])
    ).rejects.toThrow('upstream unavailable');
    expect(clients.at(-1)?.close).toHaveBeenCalledTimes(1);
  });
});
