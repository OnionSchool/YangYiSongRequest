import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { bannedWord } from '../../../utils/schema';
import { writeAudit } from '../../../utils/audit';
import { invalidateBannedWords, validateBannedRule } from '../../../utils/banned-words';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody(event);
  if (!Array.isArray(body?.words) || body.words.length > 200) {
    throw createError({ statusCode: 400, message: '屏蔽词规则最多 200 条' });
  }
  const words: string[] = [...new Set<string>(body.words.map(validateBannedRule))];

  // Delete all and re-insert
  await db.delete(bannedWord);

  for (const word of words) {
    await db.insert(bannedWord).values({
      word,
      createdAt: Math.floor(Date.now() / 1000),
    });
  }
  invalidateBannedWords();

  await writeAudit(session.userId, 'config.words', null, { count: words.length });
  return { words };
});
