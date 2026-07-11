// Centralized error-handling middleware (architecture Section 24:
// "Centralized error handling middleware mapping Mongoose validation
// errors, contract revert reasons, and unexpected exceptions into a
// consistent error response shape").
//
// This is shared infrastructure (Section 7.1), not a domain module — it
// has no knowledge of elections, votes, or candidates specifically.

import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../shared/logger.js";
import { HttpError } from "../shared/httpError.js";

interface NormalizedError {
  status: number;
  code: string;
  message: string;
}

function normalizeError(err: unknown): NormalizedError {
  if (err instanceof HttpError) {
    return { status: err.status, code: err.code, message: err.message };
  }
  if (err instanceof ZodError) {
    // A route handler's `schema.parse(req.body)` throwing means the
    // request itself was malformed - a client error (400), not an
    // internal failure. Every domain module's routes validate their
    // request bodies with zod (auth.routes.ts's siweBodySchema is the
    // first instance), so this is shared infrastructure, not
    // auth-specific - see HANDOFF.md's Phase 5 section for why this was
    // added here rather than deferred (caught by auth's own route tests).
    return {
      status: 400,
      code: "VALIDATION_ERROR",
      message: err.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "),
    };
  }
  if (err instanceof Error) {
    // Mongoose validation errors carry a `.name === "ValidationError"`.
    if (err.name === "ValidationError") {
      return { status: 400, code: "VALIDATION_ERROR", message: err.message };
    }
    // Errors surfaced from the Blockchain Service Layer (ADR-004) are
    // expected to be normalized into a consistent shape there; this
    // handler treats any remaining error as opaque/internal rather than
    // guessing at blockchain-specific error parsing here, keeping that
    // responsibility correctly confined to the blockchain module.
    return { status: 500, code: "INTERNAL_ERROR", message: err.message };
  }
  return { status: 500, code: "UNKNOWN_ERROR", message: "An unexpected error occurred" };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const normalized = normalizeError(err);

  if (normalized.status >= 500) {
    logger.error({ err }, "Unhandled error");
  } else {
    logger.warn({ err }, "Handled client error");
  }

  res.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  });
}