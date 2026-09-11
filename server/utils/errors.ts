/**
 * Domain-appropriate errors with translation-friendly messages.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly detail?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, detail?: Record<string, unknown>) =>
  new AppError(code, 400, message, detail);

export const notFound = (code: string, message: string, detail?: Record<string, unknown>) =>
  new AppError(code, 404, message, detail);

export const tooMany = (code: string, message: string, detail?: Record<string, unknown>) =>
  new AppError(code, 429, message, detail);

export const forbidden = (code: string, message: string, detail?: Record<string, unknown>) =>
  new AppError(code, 403, message, detail);
