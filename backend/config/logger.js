import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const { combine, timestamp, errors, json, colorize, printf, simple } = format;

// Custom console format for local development
const consoleFormat = printf(({ level, message, timestamp, stack, role }) => {
  return `${timestamp} [${level}]${role ? ` [${role}]` : ''}: ${stack || message}`;
});

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    json()
  ),
  transports: [
    // Console: Readable and colored for development
    new transports.Console({
      format: combine(
        colorize(),
        process.env.NODE_ENV === 'production' ? simple() : consoleFormat
      ),
    }),
    // Combined Logs: Rotates daily, kept for 14 days
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
    }),
    // Error Logs: Separate file for critical issues, kept for 30 days
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

// Handle global process errors
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection at Promise', { reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown', { message: err.message, stack: err.stack });
  // Optional: Graceful exit after logging critical crash
  // process.exit(1);
});

export default logger;
