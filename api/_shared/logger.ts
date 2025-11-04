/**
 * @file api/_shared/logger.ts
 * @description Sistema de logging estruturado
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  accountId?: string;
  scope?: string;
  merchantId?: string;
  correlationId?: string;
  endpoint?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  environment?: string;
}

class Logger {
  private context: LogContext = {};

  setContext(context: LogContext) {
    this.context = { ...this.context, ...context };
  }

  clearContext() {
    this.context = {};
  }

  private formatLog(level: LogLevel, message: string, context?: LogContext): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context, ...context },
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    };
  }

  debug(message: string, context?: LogContext) {
    const entry = this.formatLog('debug', message, context);
    console.debug(JSON.stringify(entry));
  }

  info(message: string, context?: LogContext) {
    const entry = this.formatLog('info', message, context);
    console.log(JSON.stringify(entry));
  }

  warn(message: string, context?: LogContext) {
    const entry = this.formatLog('warn', message, context);
    console.warn(JSON.stringify(entry));
  }

  error(message: string, context?: LogContext) {
    const entry = this.formatLog('error', message, context);
    console.error(JSON.stringify(entry));
  }
}

// Instância global
export const logger = new Logger();

// Funções de conveniência
export const log = {
  debug: (message: string, context?: LogContext) => logger.debug(message, context),
  info: (message: string, context?: LogContext) => logger.info(message, context),
  warn: (message: string, context?: LogContext) => logger.warn(message, context),
  error: (message: string, context?: LogContext) => logger.error(message, context),
};
