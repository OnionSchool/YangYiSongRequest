import { defineEventHandler, readBody, setHeader } from 'h3';
import { eq } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { gradeConfig } from '../../../utils/schema';
import { invalidateSiteCache } from '../../../utils/site';
import { writeAudit } from '../../../utils/audit';
import { GRADES, isGrade } from '../../../utils/domain';
import { badRequest } from '../../../utils/errors';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody<unknown>(event);
  const counts =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { counts?: unknown }).counts
      : undefined;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts))
    throw badRequest('BAD_GRADES', '班级配置无效');
  const entries = Object.entries(counts);
  if (entries.length !== GRADES.length || !GRADES.every((grade) => Object.hasOwn(counts, grade)))
    throw badRequest('BAD_GRADES', '班级配置无效');

  for (const [grade, classCount] of entries) {
    if (
      !isGrade(grade) ||
      typeof classCount !== 'number' ||
      !Number.isInteger(classCount) ||
      classCount < 1 ||
      classCount > 100
    )
      throw badRequest('BAD_GRADES', '班级数量必须是 1 到 100 的整数');
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
