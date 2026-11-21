import { defineEventHandler, setHeader } from 'h3';
import { readRequestStats } from '../../utils/requests';

/** 首页点歌概况：总点歌数、已通过数、被驳回数。只给数量，不给明细 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30');

  return readRequestStats();
});
