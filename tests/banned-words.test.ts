import { describe, expect, it } from 'vitest';
import {
  findContentScriptHits,
  normalizeContent,
  validateBannedRule,
} from '../server/utils/banned-words';

describe('内容规则', () => {
  it('规范化全角字符、空白和符号', () => {
    expect(normalizeContent(' ＢＡＤ - 词！ ')).toBe('bad词');
  });

  it('拒绝高风险正则', () => {
    expect(() => validateBannedRule('regex:(a+)+$')).toThrow('复杂语法');
    expect(validateBannedRule('regex:坏词|违规')).toBe('regex:坏词|违规');
  });

  it('按脚本拦截日文假名和韩文，不误伤汉字', () => {
    const policy = { blockJapaneseKana: true, blockKoreanHangul: true };
    expect(findContentScriptHits(policy, 'さくら')).toEqual(['日文假名']);
    expect(findContentScriptHits(policy, '봄날')).toEqual(['韩文']);
    expect(findContentScriptHits(policy, '东京爱情故事')).toEqual([]);
  });

  it('允许按配置关闭脚本拦截', () => {
    expect(
      findContentScriptHits({ blockJapaneseKana: false, blockKoreanHangul: false }, 'さくら 봄날')
    ).toEqual([]);
  });
});
