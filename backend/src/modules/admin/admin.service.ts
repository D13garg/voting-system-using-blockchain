// Admin module service layer (architecture Section 7.1). All real logic
// lives here, not in admin.routes.ts (same principle as every other
// module's service layer).
//
// KEY DESIGN FACT: VoterRegistry.sol has no concept of a "request" -
// registerVoter() is a direct ELECTION_ADMINISTRATOR_ROLE-gated on-chain
// call, wallet-direct from the frontend, same as Election.sol's
// createElection()/vote(). The RegistrationRequestModel here is entirely
// an off-chain workflow: it exists so an admin has a reviewable queue
// before deciding to spend gas confirming a registration on-chain. This
// module's approve/reject endpoints record ONLY that human decision -
// they never submit a transaction themselves.
//
// READ STRATEGY (decision (a) continuation - Admin module migration, see
// HANDOFF.md / chat history for the full design-fork discussion): every
// read here now sources onChainConfirmed from IndexedVoterRegistration
// (backend/src/modules/indexing/indexedVoterRegistration.model.ts), a
// mirror the worker maintains from VoterRegistered/VoterRemoved events -
// no live IVoterRegistryContractClient call is made anywhere in this
// file anymore. Unlike Election's migration, there is no live-read
// holdout here: nothing in this module submits a transaction and then
// needs to immediately confirm it (reviewRegistrationRequest is a purely
// off-chain decision), so every read could migrate uniformly. See
// fetchOnChainConfirmed below for why this migration also needed no
// eventual-consistency error-code split the way Election's did.
//
// AUTHORIZATION (approved design fork, same choice as Election/Voting):
// admin-only endpoints below are gated by requireAuth only (any
// logged-in wallet), not a real ELECTION_ADMINISTRATOR_ROLE check -
// harmless for the same reason as Election's admin endpoints: a
// non-admin reviewing requests in Mongo has no on-chain effect, since
// the actual registerVoter() transaction still reverts for a non-admin
// wallet regardless of what this backend's Mongo documents say. TODO:
// tighten once a real on-chain-role mirror exists.

import { HttpError } from "../../shared/httpError.js";
import { recordAuditLog } from "../audit/audit.service.js";
import { IndexedVoterRegistrationModel } from "../indexing/indexedVoterRegistration.model.js";
import { RegistrationRequestModel, type RegistrationRequestDocument } from "./admin.model.js";
import type { RegistrationRequestStatus, RegistrationRequestSummary } from "./admin.types.js";

export interface SubmitRequestInput {
  electionId: number;
  voterAddress: string;
}

export interface ReviewRequestInput {
  requestId: string;
  decision: "approved" | "rejected";
  reviewedBy: string;
}

/**
 * Reads the mirror for a given (electionId, voterAddress). Absence of a
 * document is NOT an error case here (unlike Election's
 * ELECTION_STATE_MISMATCH) - it's the correct default answer, since
 * VoterRegistry.sol itself defaults every voter to unregistered. See
 * indexedVoterRegistration.model.ts's header comment for the full
 * reasoning, including why voterAddress is lowercased here.
 */
async function fetchOnChainConfirmed(electionId: number, voterAddress: string): Promise<boolean> {
  const mirror = await IndexedVoterRegistrationModel.findOne({
    electionId,
    voterAddress: voterAddress.toLowerCase(),
  });
  return mirror?.registered ?? false;
}

async function toSummary(doc: RegistrationRequestDocument): Promise<RegistrationRequestSummary> {
  const onChainConfirmed = await fetchOnChainConfirmed(doc.electionId, doc.voterAddress);
  return {
    id: doc._id.toString(),
    electionId: doc.electionId,
    voterAddress: doc.voterAddress,
    status: doc.status,
    onChainConfirmed,
    requestedAt: doc.createdAt.toISOString(),
    reviewedBy: doc.reviewedBy,
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
  };
}

/**
 * Creates a new pending registration request, per the approved design
 * decision: a new request IS allowed after a prior rejection (a voter
 * rejected for a fixable reason - e.g. a mismatched detail the admin
 * flagged out-of-band - should be able to try again), but only one
 * non-terminal (pending or approved) request may exist at a time for a
 * given (electionId, voterAddress) pair.
 */
export async function submitRegistrationRequest(input: SubmitRequestInput): Promise<RegistrationRequestDocument> {
  const existingActive = await RegistrationRequestModel.findOne({
    electionId: input.electionId,
    voterAddress: input.voterAddress,
    status: { $in: ["pending", "approved"] },
  });
  if (existingActive) {
    throw new HttpError(
      409,
      "REGISTRATION_REQUEST_ALREADY_ACTIVE",
      `A ${existingActive.status} registration request already exists for this wallet and election.`,
    );
  }

  return RegistrationRequestModel.create({
    electionId: input.electionId,
    voterAddress: input.voterAddress,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
  });
}

export async function listRegistrationRequests(filter: {
  status?: RegistrationRequestStatus;
}): Promise<RegistrationRequestSummary[]> {
  const query = filter.status ? { status: filter.status } : {};
  const docs = await RegistrationRequestModel.find(query).sort({ createdAt: -1 });
  return Promise.all(docs.map((doc) => toSummary(doc)));
}

export async function reviewRegistrationRequest(input: ReviewRequestInput): Promise<RegistrationRequestSummary> {
  const doc = await RegistrationRequestModel.findById(input.requestId);
  if (!doc) {
    throw new HttpError(404, "REGISTRATION_REQUEST_NOT_FOUND", `No registration request found with id ${input.requestId}.`);
  }
  if (doc.status !== "pending") {
    throw new HttpError(
      409,
      "REGISTRATION_REQUEST_ALREADY_REVIEWED",
      `Registration request ${input.requestId} was already ${doc.status}.`,
    );
  }

  doc.status = input.decision;
  doc.reviewedBy = input.reviewedBy;
  doc.reviewedAt = new Date();
  await doc.save();

  // Section 17 audit entry: off-chain path, no txHash/logIndex - this
  // call site is only ever reached once per decision, guaranteed by the
  // REGISTRATION_REQUEST_ALREADY_REVIEWED check above, so no idempotency
  // key is needed (see audit.model.ts's header comment).
  await recordAuditLog({
    category: input.decision === "approved" ? "REGISTRATION_APPROVED" : "REGISTRATION_REJECTED",
    source: "off-chain",
    actor: input.reviewedBy,
    subject: doc.voterAddress,
    electionId: doc.electionId,
    metadata: { requestId: input.requestId },
    occurredAt: doc.reviewedAt,
  });

  return toSummary(doc);
}

/**
 * The current wallet's own status for a given election - "not_requested"
 * (a status value that intentionally doesn't appear in
 * RegistrationRequestStatus, since it describes the absence of any
 * document rather than a document's field) when no request exists at
 * all, otherwise the most recent request's summary (per the approved
 * resubmission-after-rejection decision, there can be more than one
 * document for the same pair - the most recent is the one that reflects
 * the voter's current standing).
 */
export async function getMyRegistrationStatus(
  electionId: number,
  voterAddress: string,
): Promise<
  RegistrationRequestSummary | { electionId: number; voterAddress: string; status: "not_requested"; onChainConfirmed: boolean }
> {
  const doc = await RegistrationRequestModel.findOne({ electionId, voterAddress }).sort({ createdAt: -1 });
  if (!doc) {
    // Still worth checking the mirror even with no Mongo document: a
    // wallet could be registered on-chain through some path other than
    // this backend's request workflow (e.g. a pre-existing deployment,
    // or a direct registerVoter() call never routed through here) - the
    // absence of a request record says nothing about on-chain fact.
    const onChainConfirmed = await fetchOnChainConfirmed(electionId, voterAddress);
    return { electionId, voterAddress, status: "not_requested", onChainConfirmed };
  }
  return toSummary(doc);
}