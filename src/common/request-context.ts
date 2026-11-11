import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request context, readable anywhere in the call chain without passing it
 * around (AppLogger reads it to tag log lines with the request id).
 */
interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const REQUEST_ID_HEADER = 'X-Request-Id';

// A caller-supplied id is reused only if it is short and plain, so it can't
// inject text into log lines.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** The current request's id, or undefined outside a request (jobs, startup). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Express middleware: takes X-Request-Id from the request (e.g. set by a proxy)
 * or generates one, echoes it in the response, and runs the rest of the
 * request inside that context.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const requestId =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  storage.run({ requestId }, next);
}
