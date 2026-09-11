/**
 * Shared runtime utilities.
 */

export function randomHex(length: number = 8): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, length);
}

/**
 * Ensure value is non-negative for page/limit calculations.
 */
export function clamp(value: number, min: number = 1, max: number = 100): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Validate 6-character alphanumeric code used as tracking codes.
 */
export function isValid6DigitCode(code: unknown): code is string {
  return typeof code === 'string' && /^[0-9A-Z]{6}$/.test(code.toUpperCase());
}
