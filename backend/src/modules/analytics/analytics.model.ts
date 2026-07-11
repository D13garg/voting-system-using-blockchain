// AnalyticsRollup storage - matches architecture Section 10's document
// model exactly. Populated exclusively by the worker process
// (analytics.worker.ts, itself triggered by eventSync.ts - see this
// file's own header comment on the trigger-mechanism fork below); the
// API process (analytics.service.ts's getAnalytics) only ever reads it.
//
// TRIGGER-MECHANISM FORK (approved, deviates from the architecture doc's
// original wording — formally recorded in
// docs/architecture/ADR/ADR-007-analytics-trigger-direct-enqueue.md,
// which also updated architecture.md Section 8 and decisions-log.md row
// #10 to match). Section 8 originally specified rollup recomputation
// "reacting to MongoDB Change Streams". Change Streams require MongoDB
// to run as a replica set; this project's docker-compose.yml runs a
// standalone `mongo:7` instance, so watching one would fail outright in
// every local dev environment as shipped. Instead, eventSync.ts's
// handleVoteCastLogs and ElectionFinalized branch directly enqueue a
// BullMQ job (analytics.queue.ts's enqueueRollupRecompute) right after
// each write - the same single writer that would otherwise be the
// subject of a Change Stream, triggering the same downstream effect
// without requiring any docker-compose/infra change. Functionally
// equivalent (still fully event-driven/reactive, not polled), lower
// operational cost. See ADR-007 for the full rationale and alternatives
// considered; if a real future need for Change Streams specifically
// (e.g. multiple independent consumers reacting to the same write,
// which a direct function call can't fan out to as cleanly) arises,
// that's a reason to revisit ADR-007, not a reason to have paid the
// replica-set cost now.
//
// SIMPLIFICATION NOTE on "locks the AnalyticsRollup as final" (Section
// 8's state-machine table, ElectionFinalized row): the schema Section 10
// actually specifies for this collection has no `isFinal`-type field to
// lock. Rather than add one not called for by the specified schema, this
// implementation treats a final recompute triggered by ElectionFinalized
// (see eventSync.ts) as the intended effect, with finality itself
// already available via the co-existing IndexedElectionModel's
// `finalized` boolean (Election module migration, decision (a)) - a
// caller wanting to know "is this rollup final" reads that flag
// alongside this one, rather than this collection duplicating it.
//
// votesByCandidate is a Mongoose Map (candidateId, stringified, -> vote
// count) rather than a plain nested object, since Mongoose's own nested-
// object change tracking has well-known pitfalls for dynamically-keyed
// data (arbitrary candidateId keys are not known upfront); analytics.
// service.ts converts to/from a plain Record at the API boundary.

import mongoose, { Schema } from "mongoose";

export interface ParticipationPoint {
  timestamp: Date;
  cumulativeVotes: number;
}

export interface AnalyticsRollupDocument extends mongoose.Document {
  onchainElectionId: number;
  totalVotes: number;
  turnoutPercent: number;
  votesByCandidate: Map<string, number>;
  participationOverTime: ParticipationPoint[];
  /** Highest block number among the IndexedVoteEvent rows this rollup was computed from. Undefined only if no votes have been indexed yet. */
  lastUpdatedFromBlock?: bigint;
}

const participationPointSchema = new Schema<ParticipationPoint>(
  {
    timestamp: { type: Date, required: true },
    cumulativeVotes: { type: Number, required: true },
  },
  { _id: false },
);

const analyticsRollupSchema = new Schema<AnalyticsRollupDocument>({
  onchainElectionId: { type: Number, required: true, unique: true },
  totalVotes: { type: Number, required: true, default: 0 },
  turnoutPercent: { type: Number, required: true, default: 0 },
  votesByCandidate: { type: Map, of: Number, default: () => new Map() },
  participationOverTime: { type: [participationPointSchema], default: [] },
  lastUpdatedFromBlock: { type: BigInt, required: false },
});

export const AnalyticsRollupModel = mongoose.model<AnalyticsRollupDocument>(
  "AnalyticsRollup",
  analyticsRollupSchema,
);