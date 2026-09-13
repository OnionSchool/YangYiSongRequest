import { describe, expect, it } from 'vitest';
import { dateLabel, hhmm, isoDate } from '../app/lib/time';

describe('前端日期显示', () => {
  it('对非法日期安全降级', () => {
    expect(dateLabel('2026-02-31')).toBe('日期未知');
  });

  it('格式化有效日期', () => {
    expect(dateLabel('2026-09-12')).toContain('9月12日');
  });

  it('对无效时间安全降级', () => {
    expect(hhmm(new Date('invalid'))).toBe('--:--');
    expect(isoDate(new Date('invalid'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
