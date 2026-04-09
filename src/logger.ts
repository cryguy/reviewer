type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type Context = Record<string, unknown>;

function log(level: LogLevel, message: string, context?: Context): void {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...context,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  debug(message: string, context?: Context): void {
    log('debug', message, context);
  },
  info(message: string, context?: Context): void {
    log('info', message, context);
  },
  warn(message: string, context?: Context): void {
    log('warn', message, context);
  },
  error(message: string, context?: Context): void {
    log('error', message, context);
  },
};
