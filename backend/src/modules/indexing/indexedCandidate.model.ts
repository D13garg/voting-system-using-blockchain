// IndexedCandidate mirror - decision (a) continuation, Candidate module
// migration (final module in this pass - see HANDOFF.md / chat history
// for the full design-fork discussion, including why setCandidateProfile
// deliberately does NOT read from this collection - see
// candidate.service.ts's header comment).
//
// Purpose-built collection for candidate identity (name/metadataURI),
// separate from CandidateProfile (which holds only the off-chain
// `bio`) - this keeps the referenced-not-embedded design settled during
// the earlier Section 10 schema reconciliation (see architecture.md):
// on-chain-authoritative identity data and off-chain-authoritative bio
// data live in two different collections with two different write
// paths, rather than being collapsed into one.
//
// DUAL-WRITE, NOT REPLACE (same approved pattern as IndexedElection/
// IndexedVoterRegistration): CandidateAdded ALSO still lands in the
// generic IndexedChainEvent log, and ALSO still updates
// IndexedElection.candidateIds exactly as before - this is a THIRD
// destination for the same event, not a replacement for the other two.
//
// SAFETY OF A STRAIGHTFORWARD MIRROR: CandidateAdded fires at most once
// per (electionId, candidateId) - Election.sol has no candidate-removal
// or candidate-edit function (verified before the IndexedElection design
// too). No ordering complication like IndexedVoterRegistration's: only
// one event type ever touches this data, so a plain upsert is
// sufficient - there's no "which of two independent event streams is
// newer" question to answer here.

import mongoose, { Schema } from "mongoose";

export interface IndexedCandidateDocument extends mongoose.Document {
  electionId: number;
  candidateId: number;
  name: string;
  metadataURI: string;
  createdAt: Date;
  updatedAt: Date;
}

const indexedCandidateSchema = new Schema<IndexedCandidateDocument>(
  {
    electionId: { type: Number, required: true },
    candidateId: { type: Number, required: true },
    name: { type: String, required: true },
    metadataURI: { type: String, required: true },
  },
  { timestamps: true },
);

indexedCandidateSchema.index({ electionId: 1, candidateId: 1 }, { unique: true });

export const IndexedCandidateModel = mongoose.model<IndexedCandidateDocument>(
  "IndexedCandidate",
  indexedCandidateSchema,
);