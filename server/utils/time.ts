/**
 * Shanghai-timezone aware utilities.
 * Server stores UTC, everything "today", "next week", etc. is handled here.
 */
const OFFSET_MS = 8 * 60 * 60 * 1000;

export function shanghaiDate(at: Date = new Date()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function shanghaiDayStart(at: Date = new Date()): Date {
  return new Date(`${shanghaiDate(at)}T00:00:00.000+08:00`);
}

export function shanghaiTime(at: Date = new Date()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}
