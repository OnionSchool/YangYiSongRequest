import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest } from '../../../utils/errors';
import { fetchExternal, validateExternalUrl } from '../../../utils/external-url';
import { analyzeLxScript, inferFieldMapFromJson } from '../../../utils/lx-parse';
import { renderTemplate } from '../../../utils/music-templates';
import type { JsonValue } from '../../../utils/music-templates';
import { parseLooseJson } from '../../../utils/music-sources';

const PROBE_TIMEOUT_MS = 8_000;
const MAX_SCRIPT_BYTES = 512 * 1024;
const PROBE_KEYWORD = '周杰伦';

/**
 * 把 lx 音源脚本翻译成模板音源配置。
 *
 * 流程：静态提取 URL 模板 → 选一个最能用的搜索模板真实探测一次 →
 * 从响应结构推断字段映射。探测失败不会阻断导入，管理员仍可手工修正。
 *
 * 注意：混淆脚本、依赖 lx.utils.crypto 动态签名的脚本无法静态还原，
 * 这一类会以 obfuscated/warnings 如实上报。
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const body = (await readBody(event)) as { script?: unknown; probe?: unknown } | null;
  if (typeof body?.script !== 'string' || !body.script.trim()) {
    throw badRequest('BAD_SCRIPT', '请提供脚本内容');
  }
  if (Buffer.byteLength(body.script, 'utf8') > MAX_SCRIPT_BYTES) {
    throw badRequest('SCRIPT_TOO_LARGE', '脚本过大，超过 512KB 上限');
  }

  const analysis = analyzeLxScript(body.script);
  const result: Record<string, unknown> = { ...analysis };

  if (body.probe === false || analysis.obfuscated) {
    return result;
  }

  // 优先选「含 ${page} 的完整搜索模板」，其次任意搜索模板。
  const searchCandidates = analysis.candidates.filter(
    (candidate) => candidate.kind === 'search' && candidate.unresolved.length === 0
  );
  const probeTarget =
    searchCandidates.find((candidate) => candidate.template.includes('${page}')) ??
    searchCandidates[0];
  if (!probeTarget) {
    return { ...result, probe: { ok: false, detail: '脚本里没有可静态解析的搜索地址' } };
  }

  let url: string;
  try {
    url = renderTemplate(probeTarget.template, { keyword: PROBE_KEYWORD, page: 1, limit: 10 });
    // 模板里残留的 ${...}（未提供变量的占位符）说明这个 URL 无法直接请求。
    if (/\$\{/.test(url)) {
      return { ...result, probe: { ok: false, detail: '搜索地址仍含未解析的占位符' } };
    }
    new URL(url);
  } catch {
    return { ...result, probe: { ok: false, detail: '搜索地址不是合法的 URL' } };
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ...result, probe: { ok: false, detail: '搜索地址不是合法的 URL' } };
  }

  try {
    await validateExternalUrl(url, [host]);
  } catch {
    return { ...result, probe: { ok: false, detail: '搜索地址未通过安全检查（内网或协议受限）' } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchExternal(url, { signal: controller.signal }, [host]);
    if (!response.ok) {
      await response.body?.cancel();
      return { ...result, probe: { ok: false, detail: `探测请求返回 HTTP ${response.status}` } };
    }
    const text = await response.text();
    let data: JsonValue;
    try {
      data = parseLooseJson(text);
    } catch {
      return { ...result, probe: { ok: false, detail: '接口响应不是有效的 JSON' } };
    }
    const inference = inferFieldMapFromJson(data);
    if (!inference) {
      return {
        ...result,
        probe: { ok: false, detail: '响应里找不到可识别的歌曲字段，需要手工填写字段映射' },
      };
    }
    return {
      ...result,
      probe: {
        ok: true,
        detail: `探测成功，识别出 ${inference.sampleCount} 条记录，其中 ${inference.songCount} 条可映射`,
        template: probeTarget.template,
        fieldMap: inference.fieldMapJson,
        singleObject: inference.singleObject,
        notes: inference.notes,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '探测请求超时'
        : '探测请求失败（网络不可达或被拒绝）';
    return { ...result, probe: { ok: false, detail: message } };
  } finally {
    clearTimeout(timer);
  }
});
