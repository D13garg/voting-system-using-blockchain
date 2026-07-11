// IndexedChainEvent storage - a generic, decoded-event audit log for the
// 5 events architecture Section 10 does NOT specify a dedicated
// collection for (ElectionCreated, CandidateAdded, ElectionFinalized,
// VoterRegistered, VoterRemoved - VoteCast gets its own
// IndexedVoteEvent, per that section). This is a judgment call, not
// something the architecture doc mandates - see eventSync.ts's header
// comment for the reasoning: nothing currently *reads* these 5 event
// types (per the approved Phase 6 scope, only the worker's write side is
// being built this pass - read-side migration is later, per module), but
// storing them now (a) proves the worker's polling+decoding pipeline
// really works end-to-end for all 6 events, satisfying the approved
// "wire up all 6 events" scope decision in a real, testable way, and (b)
// is exactly the kind of raw material Section 8's future AnalyticsRollup
// and Section 17's audit-log work will want, without this module having
// to guess bespoke per-event schemas for data nothing consumes yet.
//
// Same idempotency contract as IndexedVoteEvent - unique index on
// {txHash, logIndex}, always upserted.

import mongoose, { Schema } from "mongoose";

export type IndexedChainEventName =
  | "ElectionCreated"
  | "CandidateAdded"
  | "ElectionFinalized"
  | "VoterRegistered"
  | "VoterRemoved";

export interface IndexedChainEventDocument extends mongoose.Document {
  eventName: IndexedChainEventName;
  contractName: "Election" | "VoterRegistry";
  /** All 5 of these event types index electionId, per each contract's Solidity source. */
  electionId: number;
  /**
   * The event's non-indexed-by-topic-hash args, JSON-safe (bigints
   * stringified before storage - see eventSync.ts's serializeArgs, since
   * neither Mongoose's Mixed type nor a later JSON.stringify in an API
   * response can round-trip a raw bigint).
   */
  args: Record<string, string>;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestamp: Date;
}

const indexedChainEventSchema = new Schema<IndexedChainEventDocument>({
  eventName: {
    type: String,
    enum: ["ElectionCreated", "CandidateAdded", "ElectionFinalized", "VoterRegistered", "VoterRemoved"],
    required: true,
  },
  contractName: { type: String, enum: ["Election", "VoterRegistry"], required: true },
  electionId: { type: Number, required: true },
  args: { type: Schema.Types.Mixed, required: true },
  txHash: { type: String, required: true },
  logIndex: { type: Number, required: true },
  blockNumber: { type: BigInt, required: true },
  timestamp: { type: Date, required: true },
});

indexedChainEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
indexedChainEventSchema.index({ contractName: 1, eventName: 1, electionId: 1 });

export const IndexedChainEventModel = mongoose.model<IndexedChainEventDocument>(
  "IndexedChainEvent",
  indexedChainEventSchema,
);