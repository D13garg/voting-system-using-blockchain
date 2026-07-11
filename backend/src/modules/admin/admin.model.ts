// RegistrationRequest storage (architecture Section 14, steps 3-4: "submits
// a registration request -> admin's pending queue" / "Admin reviews and
// approves -> triggers an on-chain registerVoter tx"). See
// admin.types.ts's header comment for why this collection has no
// corresponding on-chain "request" concept to mirror - it is the
// off-chain workflow in its entirety.

import mongoose, { Schema } from "mongoose";
import type { RegistrationRequestStatus } from "./admin.types.js";

export interface RegistrationRequestDocument extends mongoose.Document {
  electionId: number;
  voterAddress: string;
  status: RegistrationRequestStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const registrationRequestSchema = new Schema<RegistrationRequestDocument>(
  {
    electionId: { type: Number, required: true },
    voterAddress: { type: String, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], required: true, default: "pending" },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Not a uniqueness constraint - by the approved design decision, a voter
// CAN have multiple requests for the same election over time (a new
// pending request is allowed after a prior rejection - see
// admin.service.ts's submitRegistrationRequest, which enforces the real
// invariant - "at most one non-terminal request at a time" -
// in application logic instead, since that invariant isn't expressible
// as a static uniqueness index once rejected rows are allowed to coexist
// with a later pending one). This index exists purely so
// listRegistrationRequests' and getMyRegistrationStatus's queries by
// (electionId, voterAddress) don't do a collection scan.
registrationRequestSchema.index({ electionId: 1, voterAddress: 1 });

export const RegistrationRequestModel = mongoose.model<RegistrationRequestDocument>(
  "RegistrationRequest",
  registrationRequestSchema,
);