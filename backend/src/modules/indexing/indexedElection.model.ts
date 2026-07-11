// IndexedElection mirror - decision (a) continuation, Election module
// migration (see HANDOFF.md / chat history for the full design-fork
// discussion). Purpose-built collection for Election's read side,
// parallel to IndexedVoteEvent's role for Voting - populated by the
// worker from three of the five previously-"generic-only" events
// (ElectionCreated, CandidateAdded, ElectionFinalized).
//
// DUAL-WRITE, NOT REPLACE (approved, explicit divergence from VoteCast's
// precedent): these three events ALSO still land in the generic
// IndexedChainEvent log exactly as before - see eventSync.ts's header
// comment for why. Only VoteCast gets an exclusive dedicated collection;
// this one is additive, to avoid silently narrowing IndexedChainEvent's
// stated audit-trail scope (architecture Section 10/17) or touching its
// already-passing tests.
//
// SAFETY OF A STRAIGHTFORWARD MIRROR: verified against contracts/
// contracts/Election.sol before this design - there is no title/timing
// mutation function and no candidate-removal function. Every field here
// is written at most once per electionId (ElectionCreated's fields),
// added-to-a-set-of (CandidateAdded), or set exactly once
// (ElectionFinalized) - there is no "what if this changes later" case to
// handle, unlike a mutable on-chain entity would require.
//
// PARTIAL-DOCUMENT CAVEAT: fields other than electionId/finalized/
// candidateIds are optional. ElectionCreated and CandidateAdded sync on
// independent per-event-type checkpoints (eventDefinitions.ts), so they
// can be processed in either order across poll cycles even though
// on-chain a CandidateAdded can only ever be emitted after its
// election's ElectionCreated. A document first touched by CandidateAdded
// (rare, but possible) will exist with only `candidateIds` populated
// until ElectionCreated's own sync pass fills in title/startTime/
// endTime/creator. Callers MUST treat a document lacking `title` as
// "not yet fully synced", never as "found" - see election.service.ts's
// fetchMirroredElection.
//
// IDEMPOTENCY: candidateIds is written via $addToSet (see
// eventSync.ts), which is naturally idempotent for a redelivered
// CandidateAdded log - no separate txHash/logIndex bookkeeping is needed
// for this field, unlike IndexedVoteEvent/IndexedChainEvent's
// per-document idempotency key (this collection has one document per
// ELECTION, aggregating many events over time, not one document per
// event).
//
// startReminderSentAt / votingOpenNotifiedAt (gap #7, election-start
// reminder): these are the "already sent" dedup markers for the
// wall-clock scan in electionStartScan.worker.ts - the first thing in
// this codebase that fires on a schedule rather than reacting to a
// chain event or HTTP request, so there is no natural at-most-once
// delivery from an event log the way ElectionFinalized gets one. A scan
// tick that finds startReminderSentAt already set for an election simply
// skips it - see electionStartScan.worker.ts for the full read-check-set
// sequence and its own note on why that's an acceptable (not
// exactly-once, but effectively-once for a single-worker-process
// deployment) guarantee.

import mongoose, { Schema } from "mongoose";

export interface IndexedElectionDocument extends mongoose.Document {
  electionId: number;
  title?: string;
  startTime?: bigint;
  endTime?: bigint;
  creator?: string;
  finalized: boolean;
  finalizedBy?: string | null;
  candidateIds: number[];
  /** Set once the gap #7 "starting soon" reminder has been dispatched for this election. Unset = not yet sent. */
  startReminderSentAt?: Date | null;
  /** Set once the gap #7 "voting is now open" notice has been dispatched for this election. Unset = not yet sent. */
  votingOpenNotifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const indexedElectionSchema = new Schema<IndexedElectionDocument>(
  {
    electionId: { type: Number, required: true },
    title: { type: String },
    startTime: { type: BigInt },
    endTime: { type: BigInt },
    creator: { type: String },
    finalized: { type: Boolean, required: true, default: false },
    finalizedBy: { type: String, default: null },
    candidateIds: { type: [Number], default: [] },
    startReminderSentAt: { type: Date, default: null },
    votingOpenNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

indexedElectionSchema.index({ electionId: 1 }, { unique: true });

export const IndexedElectionModel = mongoose.model<IndexedElectionDocument>(
  "IndexedElection",
  indexedElectionSchema,
);