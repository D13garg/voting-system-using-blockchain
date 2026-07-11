// Audit module service layer. recordAuditLog is the single writer used
// by all 3 call sites named in architecture Section 17 - eventSync.ts's
// handleRoleAuditLogs (role grants/revocations) and the ElectionCreated/
// ElectionFinalized branches of handleElectionMirrorLogs (election state
// transitions), plus admin.service.ts's reviewRegistrationRequest
// (registration approvals/rejections). See audit.model.ts's header
// comment for why on-chain vs. off-chain entries are written differently
// (idempotent upsert vs. plain insert).

import { logger } from "../../shared/logger.js";
import { AuditLogModel, type AuditLogCategory, type AuditLogSource } from "./audit.model.js";
import type { AuditLogSummary, ListAuditLogsFilter, ListAuditLogsResult } from "./audit.types.js";

const auditLogger = logger.child({ service: "audit" });

export interface RecordAuditLogInput {
  category: AuditLogCategory;
  source: AuditLogSource;
  actor: string;
  subject?: string | null;
  electionId?: number | null;
  contractName?: "Election" | "VoterRegistry" | null;
  role?: string | null;
  metadata?: Record<string, string>;
  /** On-chain identity, for idempotency - omit entirely for off-chain entries. */
  txHash?: string;
  logIndex?: number;
  blockNumber?: bigint;
  occurredAt: Date;
}

export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  const doc = {
    category: input.category,
    source: input.source,
    actor: input.actor,
    subject: input.subject ?? null,
    electionId: input.electionId ?? null,
    contractName: input.contractName ?? null,
    role: input.role ?? null,
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt,
    ...(input.txHash !== undefined ? { txHash: input.txHash } : {}),
    ...(input.logIndex !== undefined ? { logIndex: input.logIndex } : {}),
    ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
  };

  if (input.txHash !== undefined && input.logIndex !== undefined) {
    // Idempotent: a redelivered log (at-least-once delivery, same as
    // every other worker write) upserts onto the same document via the
    // sparse unique {txHash, logIndex} index rather than duplicating.
    // $setOnInsert is correct (not $set) - an audit entry never needs
    // updating once written, so redelivery should be a true no-op.
    await AuditLogModel.findOneAndUpdate(
      { txHash: input.txHash, logIndex: input.logIndex },
      { $setOnInsert: doc },
      { upsert: true },
    );
  } else {
    // Off-chain path: no txHash/logIndex to key on, but the caller
    // (reviewRegistrationRequest) already guarantees this runs at most
    // once per decision - see this module's header comment.
    await AuditLogModel.create(doc);
  }

  auditLogger.info(
    { category: input.category, actor: input.actor, subject: input.subject ?? null, electionId: input.electionId ?? null },
    "Audit log recorded",
  );
}

function toSummary(doc: {
  _id: unknown;
  category: AuditLogCategory;
  source: AuditLogSource;
  actor: string;
  subject: string | null;
  electionId: number | null;
  contractName: "Election" | "VoterRegistry" | null;
  role: string | null;
  metadata: Record<string, string>;
  txHash?: string;
  occurredAt: Date;
  createdAt: Date;
}): AuditLogSummary {
  return {
    id: String(doc._id),
    category: doc.category,
    source: doc.source,
    actor: doc.actor,
    subject: doc.subject,
    electionId: doc.electionId,
    contractName: doc.contractName,
    role: doc.role,
    metadata: doc.metadata,
    txHash: doc.txHash ?? null,
    occurredAt: doc.occurredAt.toISOString(),
    recordedAt: doc.createdAt.toISOString(),
  };
}

const MAX_LIMIT = 100;

export async function listAuditLogs(filter: ListAuditLogsFilter): Promise<ListAuditLogsResult> {
  const limit = Math.min(filter.limit, MAX_LIMIT);
  const page = Math.max(filter.page, 1);

  const query: Record<string, unknown> = {};
  if (filter.category) query.category = filter.category;
  if (filter.electionId !== undefined) query.electionId = filter.electionId;

  const [docs, total] = await Promise.all([
    AuditLogModel.find(query)
      .sort({ occurredAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLogModel.countDocuments(query),
  ]);

  return {
    entries: docs.map((doc) => toSummary(doc)),
    page,
    limit,
    total,
  };
}
