type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function stringify(entry: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(entry, (_key, value: unknown) => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Error) return serializeError(value);
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

function writeLog(
  level: LogLevel,
  scope: string,
  message: string,
  fields: LogFields = {},
  error?: unknown
) {
  const line = stringify({
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(error === undefined ? {} : { error: serializeError(error) }),
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export function logInfo(scope: string, message: string, fields?: LogFields) {
  writeLog('info', scope, message, fields);
}

export function logWarn(scope: string, message: string, fields?: LogFields) {
  writeLog('warn', scope, message, fields);
}

export function logError(
  scope: string,
  error: unknown,
  message = 'Operation failed',
  fields?: LogFields
) {
  writeLog('error', scope, message, fields, error);
}
