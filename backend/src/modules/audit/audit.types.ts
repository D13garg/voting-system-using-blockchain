// Shared types for the Audit module (architecture Section 17).

import type { AuditLogCategory, AuditLogSource } from "./audit.model.js";

export interface AuditLogSummary {
  id: string;
  category: AuditLogCategory;
  source: AuditLogSource;
  actor: string;
  subject: string | null;
  electionId: number | null;
  contractName: "Election" | "VoterRegistry" | null;
  role: string | null;
  metadata: Record<string, string>;
  txHash: string | null;
  occurredAt: string;
  recordedAt: string;
}

export interface ListAuditLogsFilter {
  category?: AuditLogCategory;
  electionId?: number;
  page: number;
  limit: number;
}

export interface ListAuditLogsResult {
  entries: AuditLogSummary[];
  page: number;
  limit: number;
  total: number;
}
