import { ConsoleLogger } from '@nestjs/common';
import type { LogLevel } from '@alune/shared';
import { logger } from './logger';

function text(message: unknown) {
  return message instanceof Error
    ? message.message
    : typeof message === 'string'
      ? message
      : JSON.stringify(message);
}

/** Keeps Nest's console output and also records framework messages in the log files. */
export class AluneNestLogger extends ConsoleLogger {
  private record(
    level: LogLevel,
    message: unknown,
    context?: string,
    stack?: string,
  ) {
    const write = {
      DEBUG: logger.debug,
      INFO: logger.info,
      WARN: logger.warn,
      ERROR: logger.error,
    }[level];
    write(
      context ? `nest:${context}` : 'nest',
      text(message),
      stack ? { stack } : undefined,
    );
  }

  log(message: unknown, context?: string) {
    super.log(message, ...(context ? [context] : []));
    // Route mapping and module init lines are startup noise at INFO.
    this.record(
      context &&
        /RouterExplorer|RoutesResolver|InstanceLoader|WebSocketsController|NestFactory/.test(
          context,
        )
        ? 'DEBUG'
        : 'INFO',
      message,
      context,
    );
  }

  error(message: unknown, stack?: string, context?: string) {
    super.error(
      message,
      ...[stack, context].filter((value) => value !== undefined),
    );
    this.record('ERROR', message, context, stack);
  }

  warn(message: unknown, context?: string) {
    super.warn(message, ...(context ? [context] : []));
    this.record('WARN', message, context);
  }

  debug(message: unknown, context?: string) {
    super.debug(message, ...(context ? [context] : []));
    this.record('DEBUG', message, context);
  }

  verbose(message: unknown, context?: string) {
    super.verbose(message, ...(context ? [context] : []));
    this.record('DEBUG', message, context);
  }

  fatal(message: unknown, context?: string) {
    super.fatal(message, ...(context ? [context] : []));
    this.record('ERROR', message, context);
  }
}
