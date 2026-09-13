function errorDetail(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
}

export function logError(
  message: string,
  error?: unknown,
  context?: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      ...(context ? { context } : {}),
      ...(error === undefined ? {} : { error: errorDetail(error) }),
    })
  );
}
