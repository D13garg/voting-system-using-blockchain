// IndexedVoteEvent storage - matches architecture Section 10's document
// model exactly (the one collection Section 10 formally specifies for
// chain-derived event data). Populated exclusively by the worker process
// (ADR-002: "the worker is the only writer" of chain-derived
// collections); the API process only ever reads this collection.
//
// Idempotency (see modules/blockchain/events.ts's header comment on
// at-least-once delivery): the unique index on {txHash, logIndex} is
// what makes a redelivered VoteCast log a no-op upsert rather than a
// duplicate record - this collection's correctness depends on every
// writer going through a findOneAndUpdate(..., {upsert: true}) keyed on
// exactly these two fields, never a plain insert.

import mongoose, { Schema } from "mongoose";

export interface IndexedVoteEventDocument extends mongoose.Document {
  electionId: number;
  voterAddress: string;
  candidateId: number;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestamp: Date;
}

const indexedVoteEventSchema = new Schema<IndexedVoteEventDocument>({
  electionId: { type: Number, required: true },
  voterAddress: { type: String, required: true },
  candidateId: { type: Number, required: true },
  txHash: { type: String, required: true },
  logIndex: { type: Number, required: true },
  blockNumber: { type: BigInt, required: true },
  timestamp: { type: Date, required: true },
});

// Idempotency key - see header comment.
indexedVoteEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
// Per Section 10: tally aggregation / turnout-over-time queries.
indexedVoteEventSchema.index({ electionId: 1, candidateId: 1 });

export const IndexedVoteEventModel = mongoose.model<IndexedVoteEventDocument>(
  "IndexedVoteEvent",
  indexedVoteEventSchema,
);