// requireAuth middleware - the reusable building block other Phase 5
// domain modules gate routes on (Election draft management, Admin
// registration approval, Voting "own receipts/history", etc. - see
// architecture Section 7.3's endpoint list and Section 13's role
// hierarchy, which all sit on top of "is there a valid session").
//
// This module deliberately does NOT check role/permission (Verified
// Voter vs Election Administrator vs System Administrator) - those are
// on-chain facts (AccessControl roles, per-election VoterRegistry
// eligibility) that can change independently of the session's lifetime,
// so they must be checked live against the chain (via the Blockchain
// Service Layer, Section 7.2) at the point of use, not baked into the
// session at login time. This middleware answers exactly one question:
// "does this request come from a wallet that has proven ownership of
// `address`," nothing more.

import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../shared/httpError.js";
import { resolveSession } from "./auth.service.js";
import { SESSION_COOKIE_NAME } from "./auth.constants.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    const auth = await resolveSession(rawToken);
    if (!auth) {
      throw new HttpError(401, "UNAUTHENTICATED", "A valid session is required for this request.");
    }
    res.locals.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Same session resolution as requireAuth, but never rejects the request -
 * useful for routes whose response shape varies by whether the caller is
 * authenticated (e.g. GET /elections might include a personalized
 * "already registered" flag if authenticated, and omit it otherwise)
 * without splitting that into two separate endpoints.
 */
export async function attachSessionIfPresent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    res.locals.auth = (await resolveSession(rawToken)) ?? undefined;
    next();
  } catch (error) {
    next(error);
  }
}