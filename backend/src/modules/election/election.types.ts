// Shared types for the Election module (architecture Section 7.1:
// "election metadata, draft management, lifecycle queries" - explicitly
// NOT vote tallying/results, which belongs to the Voting module per the
// same section).
//
// LIFECYCLE STATE (architecture Section 16 defines 8 states: Draft,
// Registration Open, Registration Closed, Voting Scheduled, Voting
// Active, Voting Ended, Result Finalized, Archived). This module now
// computes 7 of those 8 - "Voting Scheduled" is deliberately folded into
// "registration_closed" rather than kept as a separate value: Election.sol's
// createElection() sets startTime AND endTime together in one call, so
// there's no on-chain moment that could split "registration just closed,
// still waiting for start" from "waiting for start" as two procedurally
// different windows - Section 16's own table gives them no distinct
// backend responsibility beyond "reject new [registration] requests",
// which registration_closed already covers for its entire duration.
// Keeping a same-meaning extra enum value around would just be a second
// name for the same real-world period. Noting this here rather than
// letting it silently diverge from Section 16's diagram - see HANDOFF.md
// for the fuller design-fork discussion.
//
// Registration Open -> Registration Closed and Result Finalized ->
// Archived are both explicit admin actions (election.service.ts's
// closeRegistration/archiveElection), not automatic/time-based - see
// those functions' own comments for why. Registration additionally
// auto-closes as a safety net once startTime passes even if the admin
// never explicitly closed it (computeLifecycleState checks the
// startTime/endTime window before the registrationClosedAt field), so
// the displayed state can never be stuck showing "registration_open"
// once voting has actually started.
export type ElectionLifecycleState =
  | "draft"
  | "registration_open"
  | "registration_closed"
  | "voting_active"
  | "voting_ended"
  | "result_finalized"
  | "archived";

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
  /** ISO timestamp of the explicit "Close Registration" action, or null if registration hasn't been closed yet. */
  registrationClosedAt: string | null;
  /** Wallet address of the admin who closed registration, or null. */
  registrationClosedBy: string | null;
  /** ISO timestamp of the explicit "Archive" action, or null if not archived. */
  archivedAt: string | null;
  /** Wallet address of the admin who archived the election, or null. */
  archivedBy: string | null;
}