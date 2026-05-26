import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: env.SERVICE_NAME,
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: ['*.password', '*.cvv', '*.cpf', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;
