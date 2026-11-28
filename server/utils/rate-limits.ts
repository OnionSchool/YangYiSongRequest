/**
 * Request throttling constants.
 */

export const GLOBAL_RATE_LIMIT = {
  max: 240,
  timeWindow: '1 minute',
} as const;

export const SUBMIT_REQUEST_RATE_LIMIT = {
  max: 20,
  timeWindow: '10 minutes',
} as const;

export const STREAM_RATE_LIMIT = {
  max: 120,
  timeWindow: '1 minute',
} as const;

export const SEARCH_RATE_LIMIT = {
  max: 30,
  timeWindow: '1 minute',
} as const;

export const SONG_DOWNLOAD_RATE_LIMIT = {
  max: 60,
  timeWindow: '5 minutes',
} as const;

export const DAY_DOWNLOAD_RATE_LIMIT = {
  max: 10,
  timeWindow: '5 minutes',
} as const;

export const LOGIN_RATE_LIMIT = {
  max: 10,
  timeWindow: '10 minutes',
} as const;

export const IP_DAILY_LIMIT = 10;
/** 匿名设备令牌每周限额：与公告「每人每周最多一首」一致 */
export const DEVICE_WEEKLY_LIMIT = 1;
/** IP 每周限额的兜底上限：校园 NAT 下多人共享出口 IP，放宽防误伤，只拦明显异常 */
export const IP_WEEKLY_LIMIT = 5;

export function isInternalRateLimitEnabled(): boolean {
  return process.env.INTERNAL_RATE_LIMIT_ENABLED !== 'false';
}
