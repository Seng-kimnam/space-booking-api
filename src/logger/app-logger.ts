import { ConsoleLogger, ConsoleLoggerOptions, LogLevel } from '@nestjs/common';
import { createWriteStream, mkdirSync, WriteStream } from 'fs';
import { dirname } from 'path';

export interface AppLoggerOptions extends ConsoleLoggerOptions {
  /** When set, every log line is also appended to this file as JSON. */
  file?: string;
}

/**
 * Nest's built-in ConsoleLogger with an optional JSON-lines file sink.
 *
 * Why: in development the API runs on the host, so Grafana Alloy can't read its
 * stdout. Writing to a file in a mounted directory lets Alloy tail it, while the
 * console keeps the readable format. File lines use the exact shape of
 * ConsoleLogger's `json: true` output, so dev and prod logs parse the same way
 * in Loki.
 */
export class AppLogger extends ConsoleLogger {
  private readonly fileStream?: WriteStream;

  constructor({ file, ...options }: AppLoggerOptions = {}) {
    super(options);
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      this.fileStream = createWriteStream(file, { flags: 'a' });
    }
  }

  protected printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    super.printMessages(
      messages,
      context,
      logLevel,
      writeStreamType,
      errorStack,
      params,
    );

    if (!this.fileStream) {
      return;
    }
    for (const message of messages) {
      const error = message instanceof Error ? message : undefined;
      const entry = this.getJsonLogObject(error ? error.message : message, {
        context,
        logLevel,
        errorStack: errorStack ?? error?.stack,
        params,
      });
      this.fileStream.write(`${safeStringify(entry)}\n`);
    }
  }
}

// A log call must never crash the app, e.g. on a circular object.
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ message: String(value) });
  }
}
