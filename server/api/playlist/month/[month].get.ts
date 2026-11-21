import { defineEventHandler, getRouterParam, setHeader } from 'h3';
import { badRequest } from '../../../utils/errors';
import { readBroadcastMonth } from '../../../utils/schedule';

export default defineEventHandler(async (event) => {
  const month = getRouterParam(event, 'month');
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw badRequest('BAD_MONTH', '月份格式无效，应为 YYYY-MM');
  }
  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30');
  return readBroadcastMonth(month);
});
