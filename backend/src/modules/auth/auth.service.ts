// Auth module service layer (architecture Section 7.1/7.3, Section 12).
//
// Business logic lives here, not in auth.routes.ts (routes stay thin -
// same principle app.ts's header comment states for the entrypoint).

import { randomBytes, createHmac } from "node:crypto";
import { SiweMessage, generateNonce } from "siwe";
import { env } from "../../config/env.js";
import { HttpError } from "../../shared/httpError.js";
import { NonceModel, NONCE_TTL_SECONDS } from "./auth.nonce.model.js";
import { SessionModel, type SessionDocument } from "./auth.session.model.js";
import type { AuthenticatedUser } from "./auth.types.js";

const SESSION_TOKEN_BYTES = 32; // 256 bits of entropy for the raw session token

function hashSessionToken(rawToken: string): string {
  // HMAC (keyed by SIWE_SESSION_SECRET), not a plain SHA-256 hash: a raw
  // hash of a 256-bit random token would already be infeasible to
  // reverse, but keying it means a stolen DB snapshot alone still can't
  // be used to derive valid tokens for tokens not yet issued, and ties
  // the hash to a secret that can be rotated (invalidating all existing
  // sessions at once) independently of the DB itself.
  return createHmac("sha256", env.SIWE_SESSION_SECRET).update(rawToken).digest("hex");
}

export async function issueNonce(): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000);
  await NonceModel.create({ nonce, expiresAt });
  return { nonce, expiresAt };
}

export interface SiweVerificationInput {
  /** The exact EIP-4361 message string the wallet signed (SiweMessage#prepareMessage() output). */
  message: string;
  /** The signature produced by the wallet over `message`. */
  signature: string;
}

export interface SessionIssuedResult {
  address: string;
  rawToken: string;
  expiresAt: Date;
}

/**
 * Verifies a signed SIWE message against a server-issued, single-use
 * nonce, and on success issues a new session. Throws HttpError (422/401)
 * on any verification failure - never returns a partial/ambiguous result.
 */
export async function verifySiweAndCreateSession(input: SiweVerificationInput): Promise<SessionIssuedResult> {
  let siweMessage: SiweMessage;
  try {
    siweMessage = new SiweMessage(input.message);
  } catch {
    throw new HttpError(422, "INVALID_SIWE_MESSAGE", "Could not parse the SIWE message.");
  }

  // Atomic consume: the single-use guarantee lives here, not in the TTL
  // index (which only cleans up abandoned/never-consumed nonces - see
  // auth.nonce.model.ts). findOneAndDelete is atomic at the database
  // level, so two concurrent requests racing to use the same nonce can
  // never both succeed.
  const consumedNonce = await NonceModel.findOneAndDelete({
    nonce: siweMessage.nonce,
    expiresAt: { $gt: new Date() },
  });
  if (!consumedNonce) {
    throw new HttpError(401, "INVALID_OR_EXPIRED_NONCE", "This nonce is invalid, expired, or already used.");
  }

  // siwe's `.verify()` REJECTS (throws) on verification failure by
  // default - it does not reliably resolve with `{ success: false }` the
  // way its type signature (`Promise<SiweResponse>`) suggests. Confirmed
  // empirically by a real test failure (an earlier version of this code
  // only checked `!result.success` and let a real signature-mismatch
  // rejection propagate uncaught, as a raw SiweResponse-shaped rejection
  // reason rather than an HttpError) - see HANDOFF.md's Phase 5 section.
  // Handling both shapes here is defensive, not redundant: which one
  // actually occurs isn't treated as a stable contract to lock into.
  let result;
  try {
    result = await siweMessage.verify({
      signature: input.signature,
      domain: env.SIWE_DOMAIN,
      nonce: siweMessage.nonce,
    });
  } catch (error) {
    const errorType =
      error && typeof error === "object" && "error" in error
        ? (error as { error?: { type?: string } }).error?.type
        : undefined;
    throw new HttpError(401, "SIWE_VERIFICATION_FAILED", errorType ?? "Signature verification failed.");
  }

  if (!result.success) {
    throw new HttpError(401, "SIWE_VERIFICATION_FAILED", result.error?.type ?? "Signature verification failed.");
  }

  const rawToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SIWE_SESSION_TTL_SECONDS * 1000);

  await SessionModel.create({
    tokenHash: hashSessionToken(rawToken),
    address: result.data.address,
    expiresAt,
  });

  return { address: result.data.address, rawToken, expiresAt };
}

/**
 * Looks up the session for a raw token from the session cookie. Returns
 * null (not a thrown error) for any invalid/missing/expired token -
 * "not authenticated" is an expected, common outcome here, not an
 * exceptional one; auth.middleware.ts decides what to do with a null
 * result (401 for routes that require auth, or just proceed unauthenticated
 * for routes where auth is optional).
 */
export async function resolveSession(rawToken: string | undefined): Promise<AuthenticatedUser | null> {
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const session: SessionDocument | null = await SessionModel.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;

  return { address: session.address, sessionId: session.id as string };
}

export async function revokeSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await SessionModel.deleteOne({ tokenHash: hashSessionToken(rawToken) });
}

// Exported for tests only - verifying the HMAC keying property directly
// (same raw token hashes identically; a wrong secret produces a
// different hash) is more direct than only testing it indirectly through
// the full SIWE flow. Constant-time comparison isn't needed anywhere in
// this module: session lookup is an equality match inside MongoDB's own
// index (findOne/findOneAndDelete by tokenHash), not an in-process string
// comparison, so there's nothing here for the application code to time.
export const _internal = { hashSessionToken };