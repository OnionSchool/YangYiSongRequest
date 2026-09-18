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
    statusCode?: number;
    hasLocationHeader?: boolean;
    redirectCode?: string;
    responseContentType?: string;
    redirectStatus?: string;
    redirectRuleRequired?: boolean;
  };
  [key: string]: unknown;
}

function errorSummary(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error) };

  const details: Record<string, unknown> = {
    type: error.name,
    message: error.message,
  };
  const properties = error as Error & {
    code?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  if (typeof properties.code === 'string') details.code = properties.code;
  if (typeof properties.statusCode === 'number') details.statusCode = properties.statusCode;
  if (properties.cause instanceof Error) {
    details.cause = {
      type: properties.cause.name,
      message: properties.cause.message,
    };
  }
  return details;
}

export function logError(message: string, error?: unknown, context?: ErrorLogContext): void {
  console.log(
    JSON.stringify({
      level: 'error',
      time: new Date().toISOString(),
      message,
      ...(context ? { context } : {}),
      ...(error === undefined ? {} : { error: errorSummary(error) }),
    })
  );
}
