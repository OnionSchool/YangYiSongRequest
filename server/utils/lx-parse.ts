/**
 * lx 音源脚本的静态分析与字段映射推断。
 *
 * 我们不执行 lx 脚本（方案 C 已否决），但大量脚本的本质只是「模板字符串
 * 拼 URL + JSON.parse 响应」。本模块把这类脚本翻译成模板音源配置：
 *
 *   1. extractLxTemplates：从脚本里提取 URL 模板字面量，把 `${encoded}`
 *      之类的插值解析回 `${keyword}` `${id}` 等占位符。
 *   2. guessLxPlatforms：从 `source === 'mg'`、`platformMap` 之类的写法
 *      猜测脚本服务的平台。
 *   3. inferFieldMapFromJson：对真实响应做一次结构分析，推出字段映射。
 *
 * 混淆脚本（字符串加密）、依赖 lx.utils.crypto 动态签名的脚本无法静态
 * 还原，提取结果为空属预期行为，由上层如实提示。
 */

import { mapSongRecord, parseFieldMap, readField } from './music-templates';
import type { JsonValue, TemplateFieldMap } from './music-templates';
import type { SourceId } from './domain';

/** lx 平台代号 → 项目内部平台标识 */
const LX_CODE_MAP: Record<string, SourceId> = {
  wy: 'netease',
  tx: 'qq',
  kg: 'kugou',
  kw: 'kuwo',
  mg: 'migu',
  qs: 'qishui',
};

const QUALITY_LITERALS = /^(?:\d+k|flac(?:24bit)?|hires|atmos|master|standard|exhigh|lossless)$/i;

export interface LxUrlCandidate {
  /** 翻译后的模板，插值已替换为 ${keyword}/${id}/${page} 等占位符。 */
  template: string;
  kind: 'search' | 'audio' | 'unknown';
  /** 无法解析的插值名；非空表示这个 URL 不能直接投产。 */
  unresolved: string[];
  /** 抽取依据，便于管理员核对。 */
  note: string;
}

export interface LxParseResult {
  scriptName: string | null;
  platforms: SourceId[];
  candidates: LxUrlCandidate[];
  obfuscated: boolean;
  warnings: string[];
}

/** 模板字符串拼接成合法占位符后的形态检查。 */
function isHttpUrl(text: string): boolean {
  return /^https?:\/\//i.test(text) && !/\s/.test(text);
}

/** 从脚本提取 `@name` 注释里的音源名。 */
function extractScriptName(script: string): string | null {
  const match = script.match(/@name\s+([^\n*]+)/);
  return match?.[1]?.trim() ?? null;
}

/**
 * 判断脚本是否被混淆。混淆脚本典型特征是大段十六进制转义与密集数组索引，
 * 正常脚本几乎不会这样写。
 */
export function isObfuscatedScript(script: string): boolean {
  const hexEscapes = script.match(/\\x[0-9a-fA-F]{2}/g) ?? [];
  const ratio = hexEscapes.length / Math.max(1, script.length / 100);
  if (hexEscapes.length > 50 && ratio > 1) return true;
  if (/eval\s*\(|atob\s*\(|String\.fromCharCode/.test(script)) return true;
  return false;
}

/**
 * 收集脚本里变量声明的右值，供插值解析用。
 * 只识别 `const X = expr` 一行内的简单声明，且右值不含换行。
 */
function collectDeclarations(script: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const pattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;,]+)/g;
  for (const match of script.matchAll(pattern)) {
    const [, name, rhs] = match;
    if (name && rhs && !declarations.has(name)) {
      declarations.set(name, rhs.trim());
    }
  }
  return declarations;
}

/**
 * 把插值里的变量解析成模板占位符。
 * 返回 null 表示无法解析。
 */
function resolveInterpolation(
  expression: string,
  declarations: Map<string, string>
): { placeholder: string | null; qualityLiteral: string | null } {
  const expr = expression.trim();
  // 直接内嵌 encodeURIComponent(keyword) 之类的调用。
  if (/encodeURIComponent\s*\(\s*(?:info\.)?keyword/.test(expr))
    return { placeholder: 'keyword', qualityLiteral: null };
  if (/^encodeURIComponent/.test(expr) && /keyword|songname|searchKey|w\b/i.test(expr)) {
    return { placeholder: 'keyword', qualityLiteral: null };
  }
  const bare = expr.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  if (bare) {
    const lower = bare.toLowerCase();
    if (/^(page|pn|pageno|pageindex)$/.test(lower))
      return { placeholder: 'page', qualityLiteral: null };
    if (/^(limit|num|count|pagesize|size|rn)$/.test(lower))
      return { placeholder: 'limit', qualityLiteral: null };
    if (/keyword|searchkey|songname/.test(lower))
      return { placeholder: 'keyword', qualityLiteral: null };
    // 质量位：生产渲染链不支持 size 占位，这里用常见默认码率替代并记警告。
    if (/^(br|quality|level|rate|bit)$/.test(lower))
      return { placeholder: null, qualityLiteral: '320k' };
    if (
      /^(songid|musicid|mid|rid|hash|songmid|sid|id)$/.test(lower) ||
      /(songid|hash|rid)$/i.test(bare)
    ) {
      return { placeholder: 'id', qualityLiteral: null };
    }
    // 跟随变量声明的右值再解析一层（ encoded = encodeURIComponent(keyword) ）。
    const rhs = declarations.get(bare);
    if (rhs) {
      if (/encodeURIComponent\s*\(/.test(rhs) && /keyword|info\.keyword|songname/i.test(rhs)) {
        return { placeholder: 'keyword', qualityLiteral: null };
      }
      if (/^keyword$|info\.keyword/.test(rhs.trim()))
        return { placeholder: 'keyword', qualityLiteral: null };
      const quality =
        rhs.match(/qualityMap\[.+\]\s*\|\|\s*'([^']+)'/) ?? rhs.match(/^\|\|\s*'([^']+)'/);
      if (quality?.[1] && QUALITY_LITERALS.test(quality[1])) {
        return { placeholder: null, qualityLiteral: quality[1] };
      }
      if (/musicInfo\.(?:songmid|hash|id|rid)/.test(rhs) || /\.(songId|hash|rid)\b/.test(rhs)) {
        return { placeholder: 'id', qualityLiteral: null };
      }
    }
  }
  // musicInfo.songmid 之类的直接成员访问。
  if (/musicInfo\.(?:songmid|hash|id|rid|songId)\b/.test(expr)) {
    return { placeholder: 'id', qualityLiteral: null };
  }
  return { placeholder: null, qualityLiteral: null };
}

/**
 * 提取脚本中的模板字面量 URL。
 * 模板字符串里的 `${x}` 插值会被解析为占位符；普通字符串 URL 原样保留。
 */
export function extractLxTemplates(script: string): LxUrlCandidate[] {
  const declarations = collectDeclarations(script);
  const candidates: LxUrlCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    template: string,
    unresolved: string[],
    note: string,
    substitutions: string[]
  ) => {
    if (!isHttpUrl(template) || template.length > 500) return;
    let kind: LxUrlCandidate['kind'] = 'unknown';
    if (template.includes('${keyword}')) kind = 'search';
    else if (template.includes('${id}')) kind = 'audio';
    const dedupe = `${template}|${kind}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const notes = substitutions.length > 0 ? `${note}（${substitutions.join('、')}）` : note;
    candidates.push({ template, kind, unresolved, note: notes });
  };

  // 模板字面量：`https://…${x}…`。反向引用里不允许出现反引号。
  const templatePattern = /`(https?:\/\/[^`]+)`/g;
  for (const match of script.matchAll(templatePattern)) {
    const raw = match[1]!;
    const unresolved: string[] = [];
    const substitutions: string[] = [];
    let cursor = 0;
    let output = '';
    const interpPattern = /\$\{([^}]+)\}/g;
    for (const interp of raw.matchAll(interpPattern)) {
      const index = interp.index ?? 0;
      output += raw.slice(cursor, index);
      const resolved = resolveInterpolation(interp[1]!, declarations);
      if (resolved.placeholder) {
        output += `\${${resolved.placeholder}}`;
      } else if (resolved.qualityLiteral) {
        output += resolved.qualityLiteral;
        substitutions.push(`码率按 ${resolved.qualityLiteral} 固定`);
      } else {
        output += interp[0];
        unresolved.push(interp[1]!.trim().slice(0, 30));
      }
      cursor = index + interp[0].length;
    }
    output += raw.slice(cursor);
    pushCandidate(output, unresolved, '模板字符串', substitutions);
  }

  // 普通字符串 URL（没有插值的完整地址）。
  const stringPattern = /(['"])(https?:\/\/[^'"\\\s]{8,})\1/g;
  for (const match of script.matchAll(stringPattern)) {
    pushCandidate(match[2]!, [], '字符串字面量', []);
  }

  return candidates;
}

/** 从脚本的条件分支与映射表猜测平台。 */
export function guessLxPlatforms(script: string): SourceId[] {
  const codes = new Set<SourceId>();
  for (const match of script.matchAll(/source\s*={2,3}\s*'(wy|tx|kg|kw|mg|qs)'/g)) {
    const mapped = LX_CODE_MAP[match[1]!];
    if (mapped) codes.add(mapped);
  }
  // platformMap 形式的键：'tx': 'qq' / kw: 'kuwo'
  for (const match of script.matchAll(/['"]?(wy|tx|kg|kw|mg|qs)['"]?\s*:/g)) {
    const mapped = LX_CODE_MAP[match[1]!];
    if (mapped) codes.add(mapped);
  }
  // MUSIC_QUALITY 顶层声明：{"kw":[...],"wy":[...]}
  for (const match of script.matchAll(/["'](wy|tx|kg|kw|mg|qs)["']\s*:\s*\[/g)) {
    const mapped = LX_CODE_MAP[match[1]!];
    if (mapped) codes.add(mapped);
  }
  return [...codes];
}

/** 整脚本的静态分析入口。 */
export function analyzeLxScript(script: string): LxParseResult {
  const warnings: string[] = [];
  const obfuscated = isObfuscatedScript(script);
  if (obfuscated) {
    warnings.push('脚本疑似经过混淆，无法静态还原其中的接口地址');
  }
  const candidates = obfuscated ? [] : extractLxTemplates(script);
  if (!obfuscated && candidates.length === 0) {
    warnings.push('未在脚本中找到 http(s) 接口地址');
  }
  if (candidates.some((candidate) => candidate.unresolved.length > 0)) {
    warnings.push('部分地址包含无法静态解析的变量，需在下方人工核对后再保存');
  }
  if (/utils\.crypto|md5|hmac|sign\s*=|signature/i.test(script)) {
    warnings.push('脚本包含签名/加密逻辑，生成的模板可能不完整，请重点核对');
  }
  return {
    scriptName: extractScriptName(script),
    platforms: obfuscated ? [] : guessLxPlatforms(script),
    candidates,
    obfuscated,
    warnings,
  };
}

// ── 字段映射推断 ─────────────────────────────────────────────────────

/** 在一个对象里探测某字段候选名命中了哪一个。 */
function probeKey(record: JsonValue, candidates: readonly string[]): string | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const keys = Object.keys(record);
  const lowered = new Map(keys.map((key) => [key.toLowerCase(), key]));
  for (const candidate of candidates) {
    const hit = keys.find((key) => key === candidate) ?? lowered.get(candidate.toLowerCase());
    if (hit !== undefined) {
      const value = (record as Record<string, JsonValue>)[hit];
      if (value !== undefined && value !== null && value !== '') return hit;
    }
  }
  return null;
}

const PROBE_KEYS = {
  id: ['id', 'rid', 'musicrid', 'songmid', 'songId', 'nid', 'hash', 'DC_TARGETID', 'rid_str'],
  title: ['song', 'title', 'name', 'songname', 'NAME', 'SONGNAME'],
  artist: ['singer', 'artist', 'author', 'artists', 'singername', 'ARTIST', 'AARTIST'],
  album: ['album', 'albumname', 'albumName', 'ALBUM'],
  duration: ['time', 'duration', 'interval', 'duration_ms', 'DURATION', 'dt'],
  cover: ['cover', 'pic', 'picurl', 'picUrl', 'albumpic', 'img', 'coverUrl', 'MUSICRID_PIC'],
  audio: ['url', 'audio', 'audioUrl', 'musicUrl', 'mp3', 'src', 'link'],
} as const;

/**
 * 深度优先找「最像歌曲列表」的数组路径。
 * 评分：元素是对象且含 id/title 候选字段的数组得分最高。
 */
function findListPath(data: JsonValue): { path: string; records: JsonValue[] } | null {
  let best: { path: string; records: JsonValue[]; score: number } | null = null;
  const walk = (value: JsonValue, path: string, depth: number): void => {
    if (depth > 4) return;
    if (Array.isArray(value)) {
      const objects = value.filter(
        (item): item is { [key: string]: JsonValue } =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      );
      if (objects.length === 0) return;
      const sample = objects[0]!;
      const score =
        (probeKey(sample, PROBE_KEYS.id) ? 2 : 0) +
        (probeKey(sample, PROBE_KEYS.title) ? 2 : 0) +
        Math.min(objects.length, 3);
      if (score >= 4 && (!best || score > best.score)) {
        best = { path, records: value as JsonValue[], score };
      }
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child as JsonValue, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };
  walk(data, '', 0);
  return best;
}

export interface FieldMapInference {
  fieldMap: TemplateFieldMap;
  fieldMapJson: string;
  songCount: number;
  sampleCount: number;
  /** 单对象响应（无列表路径）时为 true。 */
  singleObject: boolean;
  notes: string[];
}

/**
 * 对真实响应 JSON 做结构分析，推断字段映射并用 mapSongRecord 交叉验证。
 * 推断失败时返回 null，调用方据此提示管理员手工填写。
 */
export function inferFieldMapFromJson(data: JsonValue): FieldMapInference | null {
  const notes: string[] = [];
  const listHit = findListPath(data);
  let records: JsonValue[];
  let singleObject = false;
  if (listHit) {
    records = listHit.records;
  } else {
    // 单对象形状（oiapi 这类）：对象本体就是一条歌曲记录。
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const target =
        readField(data, 'data') &&
        typeof readField(data, 'data') === 'object' &&
        !Array.isArray(readField(data, 'data'))
          ? (readField(data, 'data') as JsonValue)
          : data;
      if (probeKey(target, PROBE_KEYS.title) || probeKey(target, PROBE_KEYS.id)) {
        records = [target];
        singleObject = true;
        notes.push('响应为单对象形状，搜索每次只会返回一条结果');
      } else {
        return null;
      }
    } else {
      return null;
    }
  }
  const sample = records.find(
    (item): item is { [key: string]: JsonValue } =>
      typeof item === 'object' && item !== null && !Array.isArray(item)
  );
  if (!sample) return null;

  const fieldMap: TemplateFieldMap = {};
  if (!singleObject && listHit?.path) {
    fieldMap.list = listHit.path;
  }
  const id = probeKey(sample, PROBE_KEYS.id);
  const title = probeKey(sample, PROBE_KEYS.title);
  if (!id && !title) return null;
  if (id) fieldMap.id = id;
  if (title) fieldMap.title = title;
  const artist = probeKey(sample, PROBE_KEYS.artist);
  const album = probeKey(sample, PROBE_KEYS.album);
  const duration = probeKey(sample, PROBE_KEYS.duration);
  const cover = probeKey(sample, PROBE_KEYS.cover);
  const audio = probeKey(sample, PROBE_KEYS.audio);
  if (artist) fieldMap.artist = artist;
  if (album) fieldMap.album = album;
  if (duration) fieldMap.duration = duration;
  if (cover) fieldMap.cover = cover;
  if (audio) {
    fieldMap.audio = audio;
    notes.push('搜索结果里直接带音频直链，可以不填音频地址模板');
  }

  // 交叉验证：用推断出的映射实际跑一遍映射，要求至少一条能映射出 id+标题。
  const mapped = records
    .map((record) => mapSongRecord(record, fieldMap))
    .filter((song) => song !== null);
  if (mapped.length === 0) return null;

  const fieldMapJson = JSON.stringify(fieldMap);
  // 确认序列化结果可被 parseFieldMap 还原（防御未来格式调整）。
  parseFieldMap(fieldMapJson);
  return {
    fieldMap,
    fieldMapJson,
    songCount: mapped.length,
    sampleCount: records.length,
    singleObject,
    notes,
  };
}
