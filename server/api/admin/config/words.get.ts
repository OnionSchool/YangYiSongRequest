import { defineEventHandler, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { bannedWord } from '../../../utils/schema';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const words = await db.select().from(bannedWord);
  return { words: (words as any[]).map((w) => w.word) };
});
