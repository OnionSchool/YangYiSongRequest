import { integer, sqliteTable as table, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const calendarDay = table('CalendarDay', {
  date: text('date').primaryKey(),
  kind: text('kind').notNull(),
  note: text('note'),
});

export const broadcastSlot = table('BroadcastSlot', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  startTime: text('startTime').notNull(),
  endTime: text('endTime').notNull(),
  maxCount: integer('maxCount'),
  maxMs: integer('maxMs'),
  sortOrder: integer('sortOrder').notNull().default(0),
  enabled: integer('enabled').notNull().default(1),
});

export const scheduleDay = table('ScheduleDay', {
  date: text('date').primaryKey(),
  version: integer('version').notNull().default(0),
  updatedAt: integer('updatedAt').notNull(),
});

export const weeklyScheduleRule = table('WeeklyScheduleRule', {
  weekday: integer('weekday').notNull(),
  slotId: text('slotId').notNull(),
  sortOrder: integer('sortOrder').notNull().default(0),
});

export const dateScheduleOverride = table('DateScheduleOverride', {
  date: text('date').notNull(),
  slotId: text('slotId').notNull(),
  sortOrder: integer('sortOrder').notNull().default(0),
});

export const dateScheduleOverrideDay = table('DateScheduleOverrideDay', {
  date: text('date').primaryKey(),
});

export const gradeConfig = table('GradeConfig', {
  grade: text('grade').primaryKey(),
  classCount: integer('classCount').notNull(),
});

export const siteSetting = table('SiteSetting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const bannedWord = table('BannedWord', {
  word: text('word').primaryKey(),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const adminUser = table('AdminUser', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('displayName'),
  passwordHash: text('passwordHash').notNull(),
  role: text('role').notNull().default('PLANNER'),
  mustChangePassword: integer('mustChangePassword').notNull().default(0),
  disabled: integer('disabled').notNull().default(0),
  lastLoginAt: integer('lastLoginAt'),
  email: text('email'),
  emailVerifiedAt: integer('emailVerifiedAt'),
  sessionVersion: integer('sessionVersion').notNull().default(0),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const emailVerification = table('EmailVerification', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  email: text('email').notNull(),
  code: text('code').notNull(),
  expiresAt: integer('expiresAt').notNull(),
  usedAt: integer('usedAt'),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const adminSession = table('AdminSession', {
  id: text('id').primaryKey(),
  tokenHash: text('tokenHash').notNull().unique(),
  csrfToken: text('csrfToken').notNull(),
  userId: text('userId').notNull(),
  sessionVersion: integer('sessionVersion').notNull(),
  createdAt: integer('createdAt').notNull(),
  lastSeenAt: integer('lastSeenAt').notNull(),
  expiresAt: integer('expiresAt').notNull(),
  revokedAt: integer('revokedAt'),
});

export const loginAttempt = table('LoginAttempt', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  ip: text('ip').notNull(),
  failedAt: integer('failedAt').notNull(),
});

export const auditLog = table('AuditLog', {
  id: text('id').primaryKey(),
  actorId: text('actorId'),
  action: text('action').notNull(),
  targetId: text('targetId'),
  detail: text('detail'),
  ip: text('ip'),
  userAgent: text('userAgent'),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const songRequest = table('SongRequest', {
  id: text('id').primaryKey(),
  queryCode: text('queryCode').notNull().unique(),
  source: text('source').notNull(),
  platformId: text('platformId').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  album: text('album'),
  durationMs: integer('durationMs').notNull(),
  coverUrl: text('coverUrl'),
  grade: text('grade'),
  classNo: integer('classNo'),
  requesterName: text('requesterName'),
  status: text('status').notNull().default('PENDING'),
  rejectReason: text('rejectReason'),
  flaggedWords: text('flaggedWords').notNull().default('[]'),
  isManual: integer('isManual').notNull().default(0),
  submitIp: text('submitIp').notNull(),
  submitUserAgent: text('submitUserAgent'),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
  reviewedAt: integer('reviewedAt'),
  reviewedById: text('reviewedById'),
  playbackStatus: text('playbackStatus').notNull().default('PENDING_DOWNLOAD'),
  finalizedAt: integer('finalizedAt'),
});

export const schedule = table('Schedule', {
  id: text('id').primaryKey(),
  requestId: text('requestId').notNull().unique(),
  playDate: text('playDate').notNull(),
  slotId: text('slotId').notNull(),
  orderNo: integer('orderNo').notNull(),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const audioCacheObject = table('AudioCacheObject', {
  requestId: text('requestId').primaryKey(),
  filePath: text('filePath').notNull(),
  mimeType: text('mimeType').notNull(),
  sizeBytes: integer('sizeBytes').notNull(),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
  lastAccessAt: integer('lastAccessAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const systemAlert = table('SystemAlert', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  message: text('message').notNull(),
  detail: text('detail'),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
  resolvedAt: integer('resolvedAt'),
});

export const powChallenge = table('PowChallenge', {
  id: text('id').primaryKey(),
  contextHash: text('contextHash').notNull(),
  ipHash: text('ipHash').notNull(),
  difficulty: integer('difficulty').notNull(),
  expiresAt: integer('expiresAt').notNull(),
  usedAt: integer('usedAt'),
  failedAttempts: integer('failedAttempts').notNull().default(0),
});

export const powNonce = table('PowNonce', {
  challengeId: text('challengeId').notNull(),
  nonceHash: text('nonceHash').notNull(),
  usedAt: integer('usedAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const metingApi = table('MetingApi', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('baseUrl').notNull(),
  platforms: text('platforms').notNull().default('["netease","qq","kugou"]'),
  enabled: integer('enabled').notNull().default(1),
  sortOrder: integer('sortOrder').notNull().default(0),
  createdAt: integer('createdAt')
    .notNull()
    .default(sql`unixepoch()`),
});

export const requestRateLimit = table('RequestRateLimit', {
  key: text('key').primaryKey(),
  windowStart: integer('windowStart').notNull(),
  count: integer('count').notNull().default(0),
  blockedUntil: integer('blockedUntil'),
});
