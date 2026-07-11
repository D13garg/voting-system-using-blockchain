// IndexedVoterRegistration mirror - decision (a) continuation, Admin
// module migration (see HANDOFF.md / chat history for the full
// design-fork discussion). Purpose-built collection replacing Admin's
// live IVoterRegistryContractClient.isRegisteredForElection() call,
// populated by the worker from VoterRegistered/VoterRemoved.
//
// DUAL-WRITE, NOT REPLACE (same approved pattern as IndexedElection -
// see that model's header comment): VoterRegistered/VoterRemoved ALSO
// still land in the generic IndexedChainEvent log exactly as before.
//
// WHY THIS IS HARDER THAN IndexedElection: VoterRegistry.sol's
// AlreadyRegistered/NotCurrentlyRegistered errors confirm a voter can be
// registered, removed, and re-registered repeatedly - registered state
// is NOT write-once like every field in IndexedElection was. Worse,
// VoterRegistered and VoterRemoved sync on INDEPENDENT per-event-type
// checkpoints (eventDefinitions.ts), so they can be processed out of
// order RELATIVE TO EACH OTHER - e.g. a VoterRemoved from block 20 could
// be processed before a VoterRegistered from block 10, if that
// checkpoint happens to lag behind. "Last processed wins" would
// therefore be WRONG; this collection needs "last wins BY CHAIN ORDER"
// instead - see eventSync.ts's applyVoterRegistrationEvent, which
// implements this via a conditional write keyed on
// (lastEventBlockNumber, lastEventLogIndex).
//
// NO EVENTUAL-CONSISTENCY ERROR CASE NEEDED (unlike IndexedElection's
// ELECTION_SYNC_PENDING/ELECTION_STATE_MISMATCH split): a missing
// document here just means "never registered", which is the CORRECT
// default answer (VoterRegistry.sol itself defaults every voter to
// unregistered) - not an ambiguous or error state. A voter registered
// moments ago via a direct wallet transaction (outside this backend, as
// this module's own header comment on write-path architecture explains)
// will simply read as `registered: false` until the worker's next poll,
// then self-correct silently - a soft staleness window, not a hard
// error, so admin.service.ts's read side needs no special-casing for it.
//
// CASE-SENSITIVITY: voterAddress is stored lowercased, and MUST be
// queried lowercased too - see admin.service.ts's fetchOnChainConfirmed
// for why (a live chain call is inherently case-insensitive via
// Solidity's `address` type; a Mongo string match is not, and nothing
// else in this codebase normalizes wallet-address casing before this
// migration - verified before this design).

import mongoose, { Schema } from "mongoose";

export interface IndexedVoterRegistrationDocument extends mongoose.Document {
  electionId: number;
  /** Always lowercased - see this file's header comment on case-sensitivity. */
  voterAddress: string;
  registered: boolean;
  /** Chain-order tiebreakers for the events that produced the current `registered` value - NOT a processing-order log. */
  lastEventBlockNumber: bigint;
  lastEventLogIndex: number;
  createdAt: Date;
  updatedAt: Date;
}

const indexedVoterRegistrationSchema = new Schema<IndexedVoterRegistrationDocument>(
  {
    electionId: { type: Number, required: true },
    voterAddress: { type: String, required: true },
    registered: { type: Boolean, required: true, default: false },
    lastEventBlockNumber: { type: BigInt, required: true },
    lastEventLogIndex: { type: Number, required: true },
  },
  { timestamps: true },
);

indexedVoterRegistrationSchema.index({ electionId: 1, voterAddress: 1 }, { unique: true });

export const IndexedVoterRegistrationModel = mongoose.model<IndexedVoterRegistrationDocument>(
  "IndexedVoterRegistration",
  indexedVoterRegistrationSchema,
);