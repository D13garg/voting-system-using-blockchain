// API-facing shape for GET /analytics/:electionId. Separate from
// AnalyticsRollupDocument (analytics.model.ts) for the same reason every
// other module's *.types.ts is separate from its *.model.ts: bigint and
// Mongoose Map aren't JSON-serializable as-is, so the service layer
// converts them into this plain, response-safe shape at the boundary.

export interface ParticipationPointSummary {
  timestamp: string;
  cumulativeVotes: number;
}

export interface AnalyticsRollupSummary {
  onchainElectionId: number;
  totalVotes: number;
  turnoutPercent: number;
  votesByCandidate: Record<string, number>;
  participationOverTime: ParticipationPointSummary[];
  /** Null when no votes have been indexed for this election yet. */
  lastUpdatedFromBlock: string | null;
}