import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { bannedWord } from '../../../utils/schema';
import { writeAudit } from '../../../utils/audit';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const { words } = await readBody(event);

  // Delete all and re-insert
  await db.delete(bannedWord);

  for (const word of words) {
    if (typeof word === 'string' && word.trim()) {
      await db.insert(bannedWord).values({
        word: word.trim(),
        createdAt: Math.floor(Date.now() / 1000),
      });
    }
  }

  await writeAudit(session.userId, 'config.words', null, { count: words.length });
  return { words };
});
