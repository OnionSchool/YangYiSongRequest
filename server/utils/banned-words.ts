import { db } from './db';
import { badRequest } from './errors';

const CACHE_TTL_MS = 60_000;

type BannedRule = { raw: string; kind: 'literal' | 'regex'; value: string };

let cache: { at: number; rules: BannedRule[] } | null = null;

export function invalidateBannedWords(): void {
  cache = null;
}

export function normalizeContent(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}_]+/gu, '');
}

export function validateBannedRule(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('BAD_WORD_RULE', '屏蔽词规则必须是文本');
  const raw = value.trim();
  if (!raw || raw.length > 80)
    throw badRequest('BAD_WORD_RULE', '屏蔽词规则长度应为 1 到 80 个字符');
  if (!raw.startsWith('regex:')) {
    if (!normalizeContent(raw)) throw badRequest('BAD_WORD_RULE', '屏蔽词不能只包含空白或符号');
    return raw;
  }
  const pattern = raw.slice('regex:'.length);
  if (
    !pattern ||
    pattern.length > 60 ||
    /\(\?[!=<]|\\[1-9]|(?:\*|\+|\{\d+(?:,\d*)?\})\s*(?:\*|\+|\{)/.test(pattern)
  ) {
    throw badRequest('BAD_WORD_RULE', '正则规则包含不允许的复杂语法');
  }
  try {
    new RegExp(pattern, 'iu');
  } catch {
    throw badRequest('BAD_WORD_RULE', '正则规则格式不正确');
  }
  return raw;
}

function parseRule(raw: string): BannedRule | null {
  if (raw.startsWith('regex:')) return { raw, kind: 'regex', value: raw.slice('regex:'.length) };
  const value = normalizeContent(raw);
  return value ? { raw, kind: 'literal', value } : null;
}

async function loadRules(): Promise<BannedRule[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rules;

  let rows;
  try {
    rows = await db.query.bannedWord.findMany({
      columns: { word: true },
    });
  } catch {
    return [];
  }

  const rules = rows
    .map((row) => parseRule(row.word.trim()))
    .filter((rule): rule is BannedRule => rule !== null);
  cache = { at: Date.now(), rules };
  return rules;
}

/**
 * 返回命中的规则；字面量在规范化文本中匹配，正则只匹配原始文本。
 */
export async function findBannedHits(
  ...texts: Array<string | null | undefined>
): Promise<string[]> {
  const rules = await loadRules();
  if (rules.length === 0) return [];
  const raw = texts.filter((text): text is string => typeof text === 'string').join(' ');
  const normalized = normalizeContent(raw);
  return rules
    .filter((rule) =>
      rule.kind === 'literal'
        ? normalized.includes(rule.value)
        : new RegExp(rule.value, 'iu').test(raw)
    )
    .map((rule) => rule.raw);
}
