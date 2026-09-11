import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.ts';

const DB_PATH = path.join(process.cwd(), 'data', 'server.sqlite');

mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const sqlite = new Database(DB_PATH);

export const db = drizzle(sqlite, { schema });

export async function runMigrations(): Promise<void> {
  const migrationDir = path.join(process.cwd(), 'server', 'migrations');
  const migrations = readdirSync(migrationDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  sqlite.exec('BEGIN EXCLUSIVE');
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS "SchemaMigration" (
      "name" TEXT PRIMARY KEY NOT NULL,
      "appliedAt" INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    const applied = new Set(
      sqlite
        .prepare('SELECT "name" FROM "SchemaMigration"')
        .all()
        .map((row) => row.name as string)
    );
    const recordMigration = sqlite.prepare('INSERT INTO "SchemaMigration" ("name") VALUES (?)');
    for (const name of migrations) {
      if (applied.has(name)) continue;
      sqlite.exec(readFileSync(path.join(migrationDir, name), 'utf8'));
      recordMigration.run(name);
    }
    sqlite.exec(`
      INSERT OR IGNORE INTO "GradeConfig" ("grade", "classCount") VALUES ('G1', 23);
      INSERT OR IGNORE INTO "GradeConfig" ("grade", "classCount") VALUES ('G2', 23);
      INSERT OR IGNORE INTO "GradeConfig" ("grade", "classCount") VALUES ('G3', 23);
      INSERT OR IGNORE INTO "SiteSetting" ("key", "value") VALUES ('requestsOpen', 'true');
      INSERT OR IGNORE INTO "SiteSetting" ("key", "value") VALUES ('requireIdentity', 'true');
      INSERT OR IGNORE INTO "SiteSetting" ("key", "value") VALUES ('announcement', '');
      INSERT OR IGNORE INTO "SiteSetting" ("key", "value") VALUES ('maxScheduleDays', '14');
    `);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
