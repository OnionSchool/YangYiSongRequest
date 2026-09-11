import { describe, expect, it } from 'vitest';
import { normalizeContent, validateBannedRule } from '../server/utils/banned-words';

describe('内容规则', () => {
  it('规范化全角字符、空白和符号', () => {
    expect(normalizeContent(' ＢＡＤ - 词！ ')).toBe('bad词');
  });

  it('拒绝高风险正则', () => {
    expect(() => validateBannedRule('regex:(a+)+$')).toThrow('复杂语法');
    expect(validateBannedRule('regex:坏词|违规')).toBe('regex:坏词|违规');
  });
});
