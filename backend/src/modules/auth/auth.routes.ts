// Auth module routes (architecture Section 7.3). Deliberately thin -
// request parsing/validation and cookie plumbing only; all real logic is
// in auth.service.ts (same principle as app.ts's own header comment).
//
// Note beyond architecture Section 7.3's explicit endpoint list (which
// only names POST /auth/siwe): POST /auth/nonce, POST /auth/logout, and
// GET /auth/session are a necessary elaboration, not scope creep - SIWE
// inherently requires a server-issued nonce step before the wallet can
// sign anything (Section 12), and a session needs a way to end and a way
// to check without re-authenticating. See HANDOFF.md's Phase 5 section.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { issueNonce, verifySiweAndCreateSession, revokeSession } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";
import { SESSION_COOKIE_NAME } from "./auth.constants.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { authNonceOrSiweLimiter } from "../../middleware/rateLimiter.js";

export { SESSION_COOKIE_NAME };

export const authRouter = Router();

const siweBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, "must be a hex-encoded signature"),
});

function cookieOptions(maxAgeMs: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    // secure requires HTTPS - correctly off for local development
    // (env.NODE_ENV === "development"), on everywhere else.
    secure: env.NODE_ENV !== "development",
    sameSite: "lax",
    maxAge: maxAgeMs,
    path: "/",
  };
}

/**
 * @openapi
 * /auth/nonce:
 *   post:
 *     summary: Issue a single-use SIWE nonce
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: A fresh nonce to embed in the SIWE message the wallet will sign.
 */
authRouter.post(
  "/nonce",
  authNonceOrSiweLimiter,
  asyncHandler(async (_req: Request, res: Response) => {
    const { nonce } = await issueNonce();
    res.status(200).json({ nonce });
  }),
);

/**
 * @openapi
 * /auth/siwe:
 *   post:
 *     summary: Verify a signed SIWE message and issue a session
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Session issued; session cookie set.
 *       401:
 *         description: Signature/nonce verification failed.
 *       422:
 *         description: Malformed SIWE message.
 */
authRouter.post(
  "/siwe",
  authNonceOrSiweLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const body = siweBodySchema.parse(req.body);
    const { address, rawToken, expiresAt } = await verifySiweAndCreateSession(body);
    res.cookie(SESSION_COOKIE_NAME, rawToken, cookieOptions(expiresAt.getTime() - Date.now()));
    res.status(200).json({ address });
  }),
);

/**
 * @openapi
 * /auth/session:
 *   get:
 *     summary: Return the currently authenticated wallet address, if any
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: The authenticated address.
 *       401:
 *         description: No valid session.
 */
authRouter.get(
  "/session",
  asyncHandler(requireAuth),
  asyncHandler((_req: Request, res: Response) => {
    // requireAuth has already guaranteed res.locals.auth is set (or the
    // request never reached here - it would have been rejected with 401).
    res.status(200).json({ address: res.locals.auth!.address });
  }),
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Revoke the current session
 *     tags: [Auth]
 *     responses:
 *       204:
 *         description: Session revoked (idempotent - also returns 204 if there was no session).
 */
authRouter.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    // Deliberately does NOT use requireAuth: logging out an
    // already-expired or nonexistent session should still succeed
    // (idempotent), not 401 - the caller's goal ("I should not have a
    // session after this") is satisfied either way.
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    await revokeSession(rawToken);
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(204).send();
  }),
);