// WorkerCheckpoint storage - durable, per-event-type sync progress
// (modules/blockchain/events.ts's LogSyncCheckpoint, persisted). Each of
// the 6 events tracked by eventSync.ts has its own independent
// checkpoint row (keyed by eventKey, e.g. "Election:VoteCast"), so one
// event type falling behind or erroring never blocks or corrupts another
// event type's progress - see eventSync.ts's syncAllEvents for how that
// isolation is used.

import mongoose, { Schema } from "mongoose";

export interface WorkerCheckpointDocument extends mongoose.Document {
  eventKey: string;
  lastProcessedBlock: bigint;
  updatedAt: Date;
}

const workerCheckpointSchema = new Schema<WorkerCheckpointDocument>(
  {
    eventKey: { type: String, required: true, unique: true },
    lastProcessedBlock: { type: BigInt, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export const WorkerCheckpointModel = mongoose.model<WorkerCheckpointDocument>(
  "WorkerCheckpoint",
  workerCheckpointSchema,
);