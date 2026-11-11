import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { redact, isSensitiveKey, REDACTED } from '../utils/redact.js';

const { combine, timestamp, errors, json, colorize, printf, simple } = format;

/**
 * Last line of defence: scrub secrets/PII from EVERY log record's metadata,
 * whoever the caller is. (Previously resolvers logged full employee inputs -
 * bank accounts, Ghana Card PINs - straight into combined-*.log.)
 */
const redactFormat = format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message') continue;
    info[key] = isSensitiveKey(key) ? REDACTED : redact(info[key]);
  }
  return info;
});

const consoleFormat = printf(({ level, message, timestamp: ts, stack, role }) =>
  `${ts} [${level}]${role ? ` [${role}]` : ''}: ${stack || message}`
);

const isProd = process.env.NODE_ENV === 'production';

const logger = createLogger({
  level: isProd ? 'info' : 'debug',
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), redactFormat(), json()),
  transports: [
    new transports.Console({ format: combine(colorize(), isProd ? simple() : consoleFormat) }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
    }),
  ],
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection at Promise', { reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown', { message: err.message, stack: err.stack });
  // Process state is undefined after an uncaught exception: exit and let the
  // platform restart us. The delay lets the file transports flush.
  setTimeout(() => process.exit(1), 1000);
});

export default logger;
