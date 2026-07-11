// SIWE nonce storage (architecture Section 12: "SIWE messages include a
// nonce and domain binding" / "Replay attacks: SIWE nonces single-use and
// expire").
//
// A nonce is issued by POST /auth/nonce, embedded by the wallet into the
// SIWE message it signs, and consumed exactly once by POST /auth/siwe
// (deleted atomically on successful verification - see
// auth.service.ts's verifySiweAndCreateSession). The TTL index below is a
// defense-in-depth backstop for nonces that are issued but never
// consumed (an abandoned sign-in attempt) - it is not the primary
// single-use enforcement mechanism, which is the atomic
// findOneAndDelete in the service layer.

import mongoose, { Schema } from "mongoose";

export interface NonceDocument extends mongoose.Document {
  nonce: string;
  expiresAt: Date;
  createdAt: Date;
}

const NONCE_TTL_SECONDS = 5 * 60; // 5 minutes - short-lived by design (Section 12)

const nonceSchema = new Schema<NonceDocument>({
  nonce: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
});

// TTL index: MongoDB's background TTL monitor deletes documents some time
// after expiresAt has passed (not exactly at that instant - see
// auth.service.ts, which does not rely on this for correctness, only for
// eventual cleanup of abandoned nonces).
nonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const NonceModel = mongoose.model<NonceDocument>("Nonce", nonceSchema);

export { NONCE_TTL_SECONDS };