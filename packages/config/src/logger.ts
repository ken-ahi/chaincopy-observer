import pino, { type Logger, type LoggerOptions } from "pino";

const redactedPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "*.AUTH_SECRET",
  "*.GOOGLE_CLIENT_SECRET",
  "*.INTERNAL_API_SECRET",
  "*.CRON_SECRET",
  "*.RESEND_API_KEY",
  "*.OPENAI_API_KEY",
  "*.DATABASE_URL",
];

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? "info"): Logger {
  const options: LoggerOptions = {
    base: {
      service,
    },
    level,
    redact: {
      paths: redactedPaths,
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return pino(options);
}

export function errorDetails(error: unknown): {
  message: string;
  name: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  return {
    message: String(error),
    name: "UnknownError",
  };
}
