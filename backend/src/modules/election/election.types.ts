// Shared types for the Election module (architecture Section 7.1:
// "election metadata, draft management, lifecycle queries" - explicitly
// NOT vote tallying/results, which belongs to the Voting module per the
// same section).
//
// SCOPE NOTE on lifecycle state (architecture Section 16 defines 8
// states: Draft, Registration Open, Registration Closed, Voting
// Scheduled, Voting Active, Voting Ended, Result Finalized, Archived).
// This module can only compute a subset of those right now:
// Registration Open/Closed depend on a voter-registration-request
// workflow that lives in the not-yet-built Admin module, and Archived
// depends on an archiving policy nothing has defined yet. Until those
// exist, this module collapses "not yet on-chain" to "draft" and
// everything from on-chain creation through finalization into the four
// states below, computed live from on-chain timing rather than stored.
// Revisit this enum when the Admin module's registration workflow and an
// archiving policy exist - see HANDOFF.md for the design-fork discussion
// this simplification came out of.
export type ElectionLifecycleState =
  | "draft"
  | "voting_scheduled"
  | "voting_active"
  | "voting_ended"
  | "result_finalized";

/**
 * The API-facing shape of an election: off-chain draft metadata
 * (authoritative per architecture Section 11's on-chain/off-chain
 * table) merged with live on-chain data once the election has been
 * linked to an actual on-chain electionId. On-chain fields are
 * undefined for elections still in the "draft" state (never created
 * on-chain yet).
 */
export interface ElectionSummary {
  id: string;
  electionId: number | null;
  title: string;
  description: string;
  state: ElectionLifecycleState;
  createdBy: string;
  createdAt: string;
  startTime?: string;
  endTime?: string;
  finalized?: boolean;
  candidateCount?: number;
}