// CandidateProfile storage - the off-chain bio enrichment described in
// candidate.types.ts's header comment. Unlike Election's
// ElectionMetadata or Admin's RegistrationRequest, this has a real
// uniqueness constraint: a given on-chain (electionId, candidateId) pair
// has at most one profile document, always upserted rather than
// versioned - there's no "history of past bios" concept in the
// architecture, just the current one.

import mongoose, { Schema } from "mongoose";

export interface CandidateProfileDocument extends mongoose.Document {
  electionId: number;
  candidateId: number;
  bio: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const candidateProfileSchema = new Schema<CandidateProfileDocument>(
  {
    electionId: { type: Number, required: true },
    candidateId: { type: Number, required: true },
    bio: { type: String, required: true },
    updatedBy: { type: String, required: true },
  },
  { timestamps: true },
);

candidateProfileSchema.index({ electionId: 1, candidateId: 1 }, { unique: true });

export const CandidateProfileModel = mongoose.model<CandidateProfileDocument>(
  "CandidateProfile",
  candidateProfileSchema,
);