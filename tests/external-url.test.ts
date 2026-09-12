import { describe, expect, it } from 'vitest';
import { validateExternalUrl } from '../server/utils/external-url';

process.env.MUSIC_EXTERNAL_HOSTS = '127.0.0.1,192.168.1.1';

describe('外部地址校验', () => {
  it('拒绝回环和私有地址', async () => {
    await expect(validateExternalUrl('http://127.0.0.1/')).rejects.toMatchObject({
      code: 'BAD_URL',
    });
    await expect(validateExternalUrl('http://192.168.1.1/')).rejects.toMatchObject({
      code: 'BAD_URL',
    });
  });

  it('拒绝非 HTTP 协议', async () => {
    await expect(validateExternalUrl('file:///etc/passwd')).rejects.toMatchObject({
      code: 'BAD_URL',
    });
  });
});
