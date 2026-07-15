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
// AUTHORIZATION: the review endpoints (reviewRegistrationRequest, wired
// to POST .../approve and .../reject) are gated by requireAuth AND
// requireRole(ELECTION_ADMINISTRATOR_ROLE) at the route layer
// (admin.routes.ts) - HANDOFF.md's "Newly discovered pre-frontend
// items", item 1. Previously requireAuth-only, on the reasoning that a
// non-admin's Mongo-only decision was harmless since the real
// registerVoter() transaction still reverts for a non-admin wallet - but
// that reasoning didn't hold up: an approved-in-Mongo request the real
// admin later trusts at a glance (without independently re-checking
// on-chain eligibility) is a real, if narrow, spoofing surface, and this
// module's read strategy above means there's no on-chain step at all
// standing between a bad decision here and it being treated as
// authoritative. submitRegistrationRequest and getMyRegistrationStatus
// remain requireAuth-only, deliberately - any wallet may request its own
// registration or check its own status; only the review decision itself
// needed real role gating.

import { HttpError } from "../../shared/httpError.js";
import { recordAuditLog } from "../audit/audit.service.js";
import { getElectionContractClient } from "../blockchain/index.js";
import { listElections } from "../election/election.service.js";
import type { ElectionSummary } from "../election/election.types.js";
import { IndexedVoterRegistrationModel } from "../indexing/indexedVoterRegistration.model.js";
import { hasVoted } from "../voting/voting.service.js";
import { toDisplayName } from "../wallet/index.js";
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
  const voterDisplayName = await toDisplayName(doc.voterAddress);
  return {
    id: doc._id.toString(),
    electionId: doc.electionId,
    voterAddress: doc.voterAddress,
    voterDisplayName,
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

export interface MyElectionStatus {
  /** Mongo draft id — what /elections/:id (the frontend route) actually expects, per this session's ID-space fix. */
  id: string;
  electionId: number;
  title: string;
  state: ElectionSummary["state"];
  registrationStatus: RegistrationRequestStatus | "not_requested";
  onChainConfirmed: boolean;
  hasVoted: boolean;
}

/**
 * Voter Dashboard's data source (frontend Phase 4 session, 2026-07-13
 * design doc - see HANDOFF.md). APPROVED ARCHITECTURAL DECISION: this is
 * the first function in the backend that imports another domain
 * module's service directly (`election.service`'s listElections,
 * `voting.service`'s hasVoted) - every other cross-module dependency in
 * this codebase before this function was a shared-infra import
 * (blockchain/wallet/audit), never one domain module reaching into
 * another. The user's explicit call was to accept this coupling and
 * reuse the already-tested logic in each module, rather than
 * duplicating election-listing/hasVoted reads inside this module to
 * preserve the prior domain-module independence. If a second consumer
 * ever needs the same combination, extracting a shared read-path helper
 * would be the natural next step - but one call site doesn't justify
 * that abstraction yet.
 *
 * SHAPE: only returns elections the wallet has SOME relationship with
 * (a registration request exists, OR the mirror confirms on-chain
 * registration, OR the wallet has voted) - a personal dashboard, not a
 * copy of Landing's full list annotated per-row.
 *
 * COST: does one live `hasVoted()` contract read per non-draft election
 * (via the shared IElectionContractClient, batched with Promise.all, not
 * one request-response round trip per election the way an equivalent
 * frontend-side fan-out would have been - the user's approved
 * alternative to that). This scales with total election count, not
 * votes cast; fine at this project's scale, worth revisiting (e.g. a
 * multicall batch, or migrating hasVoted onto the indexed mirror the way
 * results already did) if that count ever grows large. Not built now -
 * no evidence yet that it needs to be.
 */
export async function getMyElectionStatuses(voterAddress: string): Promise<MyElectionStatus[]> {
  const elections = (await listElections()).filter(
    (election): election is ElectionSummary & { electionId: number } => election.electionId !== null,
  );

  const client = getElectionContractClient();
  const perElection = await Promise.all(
    elections.map(async (election) => {
      const [registration, voted] = await Promise.all([
        getMyRegistrationStatus(election.electionId, voterAddress),
        hasVoted(election.electionId, voterAddress as `0x${string}`, client, { skipExistenceCheck: true }),
      ]);
      const result: MyElectionStatus = {
        id: election.id,
        electionId: election.electionId,
        title: election.title,
        state: election.state,
        registrationStatus: registration.status,
        onChainConfirmed: registration.onChainConfirmed,
        hasVoted: voted,
      };
      return result;
    }),
  );

  return perElection.filter(
    (status) => status.registrationStatus !== "not_requested" || status.onChainConfirmed || status.hasVoted,
  );
}