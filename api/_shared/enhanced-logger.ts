/**
 * @file api/_shared/enhanced-logger.ts
 * @description Logger aprimorado com contexto e trace IDs
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  traceId?: string;
  accountId?: string;
  merchantId?: string;
  scope?: string;
  endpoint?: string;
  [key: string]: any;
}

class EnhancedLogger {
  private generateTraceId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const traceId = context?.traceId || this.generateTraceId();
    
    const parts = [
      `[${timestamp}]`,
      `[${level.toUpperCase()}]`,
      `[${traceId}]`,
    ];

    if (context?.endpoint) {
      parts.push(`[${context.endpoint}]`);
    }

    parts.push(message);

    return parts.join(' ');
  }

  private sanitizeContext(context?: LogContext): any {
    if (!context) return {};

    const sanitized = { ...context };

    // Remover dados sensíveis
    const sensitiveKeys = ['accessToken', 'refreshToken', 'access_token', 'refresh_token', 'clientSecret', 'password'];
    
    for (const key of sensitiveKeys) {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV === 'production') return;
    console.log(this.formatMessage('debug', message, context), this.sanitizeContext(context));
  }

  info(message: string, context?: LogContext): void {
    console.log(this.formatMessage('info', message, context), this.sanitizeContext(context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage('warn', message, context), this.sanitizeContext(context));
  }

  error(message: string, error?: Error | any, context?: LogContext): void {
    const errorDetails = error instanceof Error 
      ? { message: error.message, stack: error.stack }
      : { error };
    
    console.error(
      this.formatMessage('error', message, context),
      {
        ...this.sanitizeContext(context),
        error: errorDetails,
      }
    );
  }

  /**
   * Cria um logger com contexto pré-definido
   */
  withContext(baseContext: LogContext): EnhancedLogger {
    const logger = new EnhancedLogger();
    const originalMethods = {
      debug: logger.debug.bind(logger),
      info: logger.info.bind(logger),
      warn: logger.warn.bind(logger),
      error: logger.error.bind(logger),
    };

    logger.debug = (msg: string, ctx?: LogContext) => 
      originalMethods.debug(msg, { ...baseContext, ...ctx });
    logger.info = (msg: string, ctx?: LogContext) => 
      originalMethods.info(msg, { ...baseContext, ...ctx });
    logger.warn = (msg: string, ctx?: LogContext) => 
      originalMethods.warn(msg, { ...baseContext, ...ctx });
    logger.error = (msg: string, err?: Error | any, ctx?: LogContext) => 
      originalMethods.error(msg, err, { ...baseContext, ...ctx });

    return logger;
  }
}

export const logger = new EnhancedLogger();
