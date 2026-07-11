// Election module service layer (architecture Section 7.1). All real
// logic lives here, not in election.routes.ts (same principle as
// auth.service.ts's header comment).
//
// READ STRATEGY (decision (a) continuation - Election module migration,
// see HANDOFF.md / chat history for the full design-fork discussion):
// listElections/getElectionById below no longer make a live chain call.
// They read from IndexedElection (backend/src/modules/indexing/
// indexedElection.model.ts), a mirror the worker now maintains from
// ElectionCreated/CandidateAdded/ElectionFinalized events - the same
// kind of migration Voting's /results endpoint got first (see that
// module's header comment for the precedent).
//
// linkOnChainElection is DELIBERATELY NOT part of this migration - it
// keeps its own live client.getElection() call, because it's validating
// a transaction that was just submitted moments ago, which the worker
// (polling every RECOMMENDED_POLL_INTERVAL_MS) cannot possibly have
// indexed yet. This mirrors the same reasoning Voting's migration used
// to decide what stays live vs. what moves to the mirror.
//
// EVENTUAL CONSISTENCY (approved fork - see fetchMirroredElection
// below): because the mirror lags the chain by up to one poll interval,
// "no mirror document yet" is genuinely ambiguous right after a fresh
// link - it could mean real corruption (the pre-migration meaning of
// ELECTION_STATE_MISMATCH), or just that the worker hasn't caught up
// yet. These are distinguished using the linked ElectionMetadata
// document's own `updatedAt` (bumped by linkOnChainElection's
// doc.save()): within a grace window of the link, an incomplete mirror
// is treated as "still syncing" (503 ELECTION_SYNC_PENDING, safe to
// retry); past that window, it's treated as the genuine mismatch case
// (404 ELECTION_STATE_MISMATCH, as before).
//
// AUTHORIZATION (approved design fork): draft creation/linking below
// only checks "is there a valid session" (via requireAuth in
// election.routes.ts), not "does this wallet actually hold
// ELECTION_ADMINISTRATOR_ROLE on-chain". Real enforcement still happens
// at the point the admin's wallet submits the actual createElection()
// transaction directly to the chain (which reverts for a non-admin,
// per Election.sol's onlyRole modifier) - a non-admin creating bogus
// Mongo drafts is a harmless nuisance, not a security hole, since drafts
// carry no on-chain effect until deliberately linked. TODO: once the
// Admin module exists (with its on-chain role mirror per Section 11),
// gate this with a real role check instead.

import { HttpError } from "../../shared/httpError.js";
import { BlockchainError, RECOMMENDED_POLL_INTERVAL_MS } from "../blockchain/index.js";
import type { ElectionData, IElectionContractClient } from "../blockchain/index.js";
import { IndexedElectionModel } from "../indexing/indexedElection.model.js";
import { ElectionMetadataModel, type ElectionMetadataDocument } from "./election.model.js";
import type { ElectionLifecycleState, ElectionSummary } from "./election.types.js";

export interface CreateDraftInput {
  title: string;
  description: string;
  createdBy: string;
}

export interface LinkOnChainInput {
  draftId: string;
  electionId: number;
  transactionHash: string;
}

/**
 * The common shape toSummary/computeLifecycleState need, regardless of
 * whether it came from a live client.getElection() call (linkOnChainElection)
 * or the IndexedElection mirror (listElections/getElectionById) - keeps
 * those two functions from needing to know which source they were given.
 */
interface OnChainElectionView {
  title: string;
  startTime: bigint;
  endTime: bigint;
  finalized: boolean;
  candidateCount: number;
}

function toView(onChain: ElectionData): OnChainElectionView {
  return {
    title: onChain.title,
    startTime: onChain.startTime,
    endTime: onChain.endTime,
    finalized: onChain.finalized,
    candidateCount: Number(onChain.candidateCount),
  };
}

/**
 * A "still syncing" grace window - a mirror document missing or
 * incomplete within this long after a link is assumed to be worker lag,
 * not real corruption. 2x the recommended poll interval to comfortably
 * cover one full poll cycle plus scheduling jitter.
 */
const MIRROR_SYNC_GRACE_MS = RECOMMENDED_POLL_INTERVAL_MS * 2;

function computeLifecycleState(onChain: OnChainElectionView | undefined, now: Date): ElectionLifecycleState {
  if (!onChain) return "draft";
  if (onChain.finalized) return "result_finalized";

  const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
  if (nowSeconds < onChain.startTime) return "voting_scheduled";
  if (nowSeconds < onChain.endTime) return "voting_active";
  return "voting_ended";
}

function toSummary(doc: ElectionMetadataDocument, onChain: OnChainElectionView | undefined, now: Date): ElectionSummary {
  return {
    id: doc._id.toString(),
    electionId: doc.electionId,
    title: onChain?.title ?? doc.title,
    description: doc.description,
    state: computeLifecycleState(onChain, now),
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    ...(onChain && {
      startTime: new Date(Number(onChain.startTime) * 1000).toISOString(),
      endTime: new Date(Number(onChain.endTime) * 1000).toISOString(),
      finalized: onChain.finalized,
      candidateCount: onChain.candidateCount,
    }),
  };
}

/**
 * Reads a linked draft's on-chain state from the IndexedElection mirror.
 * Returns undefined for a draft that isn't linked yet (nothing to read).
 *
 * Throws HttpError(503, ELECTION_SYNC_PENDING) if the mirror hasn't
 * caught up yet and the link happened recently (see MIRROR_SYNC_GRACE_MS
 * above) - a transient, retry-safe state, not a real problem.
 *
 * Throws HttpError(404, ELECTION_STATE_MISMATCH) if the mirror still has
 * no record past the grace window - a genuine data-integrity problem
 * (should only happen if the chain state was somehow rolled back, e.g. a
 * local Hardhat node reset during development), not a normal "not
 * found" case for callers to treat as absence.
 */
async function fetchMirroredElection(
  doc: ElectionMetadataDocument,
): Promise<OnChainElectionView | undefined> {
  if (doc.electionId === null) return undefined;

  const mirror = await IndexedElectionModel.findOne({ electionId: doc.electionId });
  // A document can exist but still be partial - see
  // indexedElection.model.ts's header comment on out-of-order
  // ElectionCreated/CandidateAdded processing. `title` is only ever set
  // by ElectionCreated, so its presence is what "fully synced" means.
  if (mirror && mirror.title !== undefined && mirror.startTime !== undefined && mirror.endTime !== undefined) {
    return {
      title: mirror.title,
      startTime: mirror.startTime,
      endTime: mirror.endTime,
      finalized: mirror.finalized,
      candidateCount: mirror.candidateIds.length,
    };
  }

  const msSinceLinked = Date.now() - doc.updatedAt.getTime();
  if (msSinceLinked <= MIRROR_SYNC_GRACE_MS) {
    throw new HttpError(
      503,
      "ELECTION_SYNC_PENDING",
      `Election ${doc._id.toString()} was linked to on-chain electionId ${doc.electionId} recently; the background indexer hasn't caught up yet. Retry shortly.`,
    );
  }
  throw new HttpError(
    404,
    "ELECTION_STATE_MISMATCH",
    `Draft ${doc._id.toString()} is linked to on-chain electionId ${doc.electionId}, but the indexer still has no record of that election after ${Math.round(MIRROR_SYNC_GRACE_MS / 1000)}s - this usually means the chain state was rolled back (e.g. a local Hardhat node reset).`,
  );
}

export async function listElections(): Promise<ElectionSummary[]> {
  const docs = await ElectionMetadataModel.find().sort({ createdAt: -1 });
  const now = new Date();
  return Promise.all(
    docs.map(async (doc) => {
      const onChain = await fetchMirroredElection(doc);
      return toSummary(doc, onChain, now);
    }),
  );
}

export async function getElectionById(id: string): Promise<ElectionSummary> {
  const doc = await ElectionMetadataModel.findById(id);
  if (!doc) {
    throw new HttpError(404, "ELECTION_NOT_FOUND", `No election found with id ${id}.`);
  }
  const onChain = await fetchMirroredElection(doc);
  return toSummary(doc, onChain, new Date());
}

export async function createDraft(input: CreateDraftInput): Promise<ElectionSummary> {
  const doc = await ElectionMetadataModel.create({
    title: input.title,
    description: input.description,
    createdBy: input.createdBy,
    electionId: null,
    linkTransactionHash: null,
  });
  return toSummary(doc, undefined, new Date());
}

export async function linkOnChainElection(
  input: LinkOnChainInput,
  client: IElectionContractClient,
): Promise<ElectionSummary> {
  const doc = await ElectionMetadataModel.findById(input.draftId);
  if (!doc) {
    throw new HttpError(404, "ELECTION_NOT_FOUND", `No election found with id ${input.draftId}.`);
  }
  if (doc.electionId !== null) {
    throw new HttpError(
      409,
      "ELECTION_ALREADY_LINKED",
      `Draft ${input.draftId} is already linked to on-chain electionId ${doc.electionId}.`,
    );
  }

  // Integrity check: confirm the contract actually knows about this
  // electionId before recording the link - prevents a typo'd or
  // malicious electionId in the request body from silently corrupting
  // this draft's record. Stays a LIVE chain read (not the mirror) - see
  // this module's header comment on why.
  let onChain: ElectionData;
  try {
    onChain = await client.getElection(BigInt(input.electionId));
  } catch (error) {
    if (error instanceof BlockchainError && error.revertErrorName === "ElectionDoesNotExist") {
      throw new HttpError(
        422,
        "ONCHAIN_ELECTION_NOT_FOUND",
        `electionId ${input.electionId} does not exist on-chain. Wait for the transaction to confirm before linking.`,
      );
    }
    throw error;
  }

  const alreadyLinked = await ElectionMetadataModel.findOne({ electionId: input.electionId });
  if (alreadyLinked) {
    throw new HttpError(
      409,
      "ONCHAIN_ELECTION_ALREADY_LINKED",
      `On-chain electionId ${input.electionId} is already linked to a different draft.`,
    );
  }

  doc.electionId = input.electionId;
  doc.linkTransactionHash = input.transactionHash;
  await doc.save();

  return toSummary(doc, toView(onChain), new Date());
}