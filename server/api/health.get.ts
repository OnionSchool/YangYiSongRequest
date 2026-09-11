import { defineEventHandler, setHeader } from 'h3';
import { getHealth } from '../utils/lifecycle';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-cache');

  const health = await getHealth();
  return health;
});
