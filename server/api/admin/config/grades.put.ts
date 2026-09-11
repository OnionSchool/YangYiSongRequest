import { defineEventHandler, readBody, setHeader } from 'h3';
import { eq } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { gradeConfig } from '../../../utils/schema';
import { invalidateSiteCache } from '../../../utils/site';
import { writeAudit } from '../../../utils/audit';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const { counts } = await readBody(event);

  for (const [grade, classCount] of Object.entries(counts)) {
    const existing = await db
      .select()
      .from(gradeConfig)
      .where(eq(gradeConfig.grade, grade))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(gradeConfig)
        .set({ classCount: Number(classCount) })
        .where(eq(gradeConfig.grade, grade));
    } else {
      await db.insert(gradeConfig).values({ grade, classCount: Number(classCount) });
    }
  }

  invalidateSiteCache();
  await writeAudit(session.userId, 'config.grades', null, counts);
  return { ok: true };
});
