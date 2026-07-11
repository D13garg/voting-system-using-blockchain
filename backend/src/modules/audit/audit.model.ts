// AuditLog storage (architecture Section 17: "a dedicated, append-only
// AuditLog collection for privileged actions - role grants/revocations,
// registration approvals/rejections, election state transitions. Never
// rotated/deleted on a short retention window"). Deliberately a plain
// collection with no TTL index and no capped-collection option - both of
// those mechanisms delete old documents, which is exactly what this
// section rules out. Retention/archival, if ever needed, is a future
// operational decision (e.g. periodic export to cold storage), not
// something this schema enforces.
//
// THREE SOURCES, ONE SHAPE (see audit.service.ts's recordAuditLog for
// where each is called from):
//   - On-chain, per-event-idempotent: RoleGranted/RoleRevoked (both
//     contracts - eventSync.ts's handleRoleAuditLogs), ElectionCreated/
//     ElectionFinalized (eventSync.ts's handleElectionMirrorLogs). These
//     always carry txHash+logIndex and go through the same
//     at-least-once-delivery idempotent-upsert discipline as every other
//     mirror in this codebase.
//   - Off-chain, naturally-once: registration approve/reject
//     (admin.service.ts's reviewRegistrationRequest, already guarded
//     against double-review by RegistrationRequestModel's own state
//     check before this is ever called). No txHash/logIndex exists for
//     these - the fields are simply omitted (not set to null), which is
//     what makes the sparse unique index below safe for them.
//
// IDEMPOTENCY INDEX: sparse + unique on {txHash, logIndex}. Sparse means
// documents that don't have the field at all (the off-chain case) are
// excluded from the index entirely, so multiple off-chain entries never
// collide on "missing key" the way a plain unique index would. On-chain
// entries always set both fields, so redelivery of the same log
// correctly upserts onto the same document instead of duplicating.

import mongoose, { Schema } from "mongoose";

export type AuditLogCategory =
  | "ROLE_GRANTED"
  | "ROLE_REVOKED"
  | "ELECTION_CREATED"
  | "ELECTION_FINALIZED"
  | "REGISTRATION_APPROVED"
  | "REGISTRATION_REJECTED";

export type AuditLogSource = "on-chain" | "off-chain";

export interface AuditLogDocument extends mongoose.Document {
  category: AuditLogCategory;
  source: AuditLogSource;
  /** Wallet address that performed the action (tx sender / reviewing admin). */
  actor: string;
  /** Wallet address the action targeted, e.g. role recipient or registered voter. Null when not applicable (e.g. ElectionCreated has no separate subject). */
  subject: string | null;
  electionId: number | null;
  contractName: "Election" | "VoterRegistry" | null;
  /** Human-readable role name (see eventDefinitions.ts's roleNameFromHash) - only set for ROLE_GRANTED/ROLE_REVOKED. */
  role: string | null;
  /** Free-form supporting context (e.g. { requestId } for registration decisions). Values pre-stringified, same JSON-safety rationale as eventSync.ts's serializeArgs. */
  metadata: Record<string, string>;
  /** Omitted entirely (not null) for off-chain entries - see this file's header comment. */
  txHash?: string;
  logIndex?: number;
  blockNumber?: bigint;
  /** When the audited action actually happened (block timestamp for on-chain, decision time for off-chain) - distinct from Mongoose's own createdAt (when this document was written), which can lag behind for on-chain entries processed after the fact by the worker. */
  occurredAt: Date;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    category: {
      type: String,
      enum: [
        "ROLE_GRANTED",
        "ROLE_REVOKED",
        "ELECTION_CREATED",
        "ELECTION_FINALIZED",
        "REGISTRATION_APPROVED",
        "REGISTRATION_REJECTED",
      ],
      required: true,
    },
    source: { type: String, enum: ["on-chain", "off-chain"], required: true },
    actor: { type: String, required: true },
    subject: { type: String, default: null },
    electionId: { type: Number, default: null },
    contractName: { type: String, enum: ["Election", "VoterRegistry"], default: null },
    role: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    txHash: { type: String },
    logIndex: { type: Number },
    blockNumber: { type: BigInt },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ txHash: 1, logIndex: 1 }, { unique: true, sparse: true });
auditLogSchema.index({ category: 1, occurredAt: -1 });
auditLogSchema.index({ electionId: 1, occurredAt: -1 });

export const AuditLogModel = mongoose.model<AuditLogDocument>("AuditLog", auditLogSchema);
