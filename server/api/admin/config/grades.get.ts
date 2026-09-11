import { defineEventHandler, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { gradeConfig } from '../../../utils/schema';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const grades = await db.select().from(gradeConfig);
  return (grades as any[]).map((g) => ({
    grade: g.grade,
    classCount: g.classCount,
  }));
});
