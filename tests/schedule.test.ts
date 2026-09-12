import { describe, expect, it } from 'vitest';
import { isValidDate } from '../server/utils/schedule';

describe('播出日期校验', () => {
  it('拒绝格式正确但不存在的日期', () => {
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-99-99')).toBe(false);
  });

  it('接受有效日期', () => {
    expect(isValidDate('2028-02-29')).toBe(true);
  });
});
