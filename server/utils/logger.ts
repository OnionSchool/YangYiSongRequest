interface ErrorLogContext {
  request?: {
    method: string;
    path: string;
    statusCode: number;
  };
  meting?: {
    api: string;
    source?: string;
    capability?: string;
    platformId?: string;
  };
  [key: string]: unknown;
}

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

export function logError(message: string, error?: unknown, context?: ErrorLogContext): void {
  console.log(
    JSON.stringify({
      level: 'error',
      time: new Date().toISOString(),
      message,
      ...(context ? { context } : {}),
      ...(error === undefined ? {} : { exception: errorDetail(error) }),
    })
  );
}
