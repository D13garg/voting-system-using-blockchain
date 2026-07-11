// Request correlation ID middleware (architecture Section 17: "correlation
// IDs across API/worker logs let a developer reconstruct the full path of
// a single vote or registration request across both processes").
//
// Accepts an inbound X-Correlation-ID (e.g., propagated from the frontend
// or a calling service), or generates one. Attaches it to res.locals so
// downstream domain-module handlers can include it in any job they enqueue
// for the worker (BullMQ job data), closing the loop end-to-end.

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const CORRELATION_HEADER = "x-correlation-id";

// IMPORTANT: this augments the GLOBAL `Express.Locals` namespace
// interface, not express's own re-exported `Locals` type (a different
// interface that happens to share a name) - see modules/auth/auth.types.ts
// for the full explanation of why this specific form is required (a real,
// dormant bug found and fixed there in Phase 5: the wrong form silently
// typechecks but leaves res.locals effectively `any`).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      correlationId: string;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(CORRELATION_HEADER);
  const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();

  res.locals.correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);

  next();
}