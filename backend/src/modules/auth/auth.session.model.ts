// Session storage - DB-stored, hashed, revocable (deliberate choice over
// a stateless JWT; see HANDOFF.md's Phase 5 section for the tradeoff
// discussion). Only a hash of the session token is ever stored, same
// rationale as password hashing: a database compromise alone must not
// yield a usable session token (see auth.service.ts for the hashing).

import mongoose, { Schema } from "mongoose";

export interface SessionDocument extends mongoose.Document {
  tokenHash: string;
  /** EIP-55 checksummed address (as returned by siwe's SiweMessage parsing). */
  address: string;
  createdAt: Date;
  expiresAt: Date;
}

const sessionSchema = new Schema<SessionDocument>({
  tokenHash: { type: String, required: true, unique: true },
  address: { type: String, required: true, index: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
  expiresAt: { type: Date, required: true },
});

// TTL index for eventual cleanup. Like the Nonce model, request-time
// validity is NOT decided by whether MongoDB has gotten around to
// deleting an expired document yet - auth.middleware.ts explicitly checks
// `expiresAt > now` in its query, since the TTL background monitor only
// sweeps periodically (documents can outlive their expiresAt by up to
// ~60s in the DB, which must never translate into a still-valid session).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel = mongoose.model<SessionDocument>("Session", sessionSchema);