// Wraps an async Express route handler so rejected promises are forwarded
// to next(error) automatically, and the wrapped function's return type
// satisfies Express's own (req, res, next) => void handler signature.
// Shared infrastructure (utils/ - Section 7.1) - every domain module's
// routes file needs this, not just Auth's.

import type { NextFunction, Request, Response } from "express";

type MaybeAsyncHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

export function asyncHandler(handler: MaybeAsyncHandler): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}