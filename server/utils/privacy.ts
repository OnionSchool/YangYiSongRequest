import { sqlite } from './db';

const ANONYMIZE_AFTER_SECONDS = 7 * 24 * 60 * 60;

export function anonymizeFinalizedRequests(now = Math.floor(Date.now() / 1000)): number {
  const result = sqlite
    .prepare(
      `UPDATE "SongRequest"
      SET "requesterName" = NULL,
          "grade" = NULL,
          "classNo" = NULL,
          "queryCode" = 'EXPIRED-' || "id"
      WHERE "finalizedAt" IS NOT NULL
        AND "finalizedAt" <= ?
        AND "queryCode" NOT LIKE 'EXPIRED-%'`
    )
    .run(now - ANONYMIZE_AFTER_SECONDS);
  return result.changes;
}
