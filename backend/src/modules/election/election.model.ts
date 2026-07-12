// ElectionMetadata storage (architecture Section 11: election title is
// mirrored here once on-chain, description is authoritative here always;
// Section 16's Draft state is "store in MongoDB only; nothing on-chain
// yet").
//
// DESIGN NOTE (see HANDOFF.md for the full design-fork discussion): no
// background worker exists yet (Phase 6) to discover elections created
// on-chain out-of-band. This collection is therefore the complete
// inventory of elections this system knows about - every election is
// assumed to have started life as a draft created via POST
// /elections/draft in this module, later linked to its real on-chain
// electionId via PATCH /elections/draft/:id/link-onchain once the
// admin's own wallet transaction confirms. An on-chain election created
// through some other path (e.g. directly against the contract, bypassing
// this backend entirely) would not appear here - discovering those is
// exactly the reconciliation job Phase 6's worker is meant to add later.

import mongoose, { Schema } from "mongoose";

export interface ElectionMetadataDocument extends mongoose.Document {
  title: string;
  description: string;
  /** Set once linked to a real on-chain election; null while still a draft. */
  electionId: number | null;
  /** The transaction hash of the createElection() call, recorded at link time for audit purposes. */
  linkTransactionHash: string | null;
  /** Wallet address of the admin who created this draft (off-chain audit trail, not an access-control check). */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const electionMetadataSchema = new Schema<ElectionMetadataDocument>(
  {
    title: { type: String, required: true, trim: true, minlength: 1 },
    description: { type: String, required: false, default: "" },
    electionId: { type: Number, default: null },
    linkTransactionHash: { type: String, default: null },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

// Sparse: many documents will have electionId: null (still drafts), and a
// unique index on a field most documents omit/null needs `sparse` so
// MongoDB doesn't try to enforce uniqueness across all the nulls.
electionMetadataSchema.index({ electionId: 1 }, { unique: true, sparse: true });

export const ElectionMetadataModel = mongoose.model<ElectionMetadataDocument>(
  "ElectionMetadata",
  electionMetadataSchema,
);