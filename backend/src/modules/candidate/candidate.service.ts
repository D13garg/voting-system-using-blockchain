// Candidate module service layer (architecture Section 7.1). All real
// logic lives here, not in candidate.routes.ts.
//
// KEY DESIGN FACT (see candidate.types.ts's header comment): unlike
// Election, a candidate has no off-chain "draft" phase at all -
// Election.sol's addCandidate(electionId, name, metadataURI) is a single
// wallet-direct on-chain call, same pattern as createElection()/vote().
// There is nothing for this module to create; it only enriches a
// candidate that must already exist on-chain with a bio Mongo alone can
// hold.
//
// READ STRATEGY (decision (a) continuation - Candidate module migration,
// the final module in this pass, see HANDOFF.md / chat history for the
// full design-fork discussion):
//
// - listCandidates is now mirror-backed: election existence + candidate
//   count come from IndexedElection (same mirror Election's own module
//   uses), and each candidate's name/metadataURI come from the new
//   IndexedCandidate collection - see that model's header comment for
//   why this is a separate collection from CandidateProfile (bio).
//
// - setCandidateProfile's existence checks DELIBERATELY STAY LIVE (both
//   the election and the candidate) - approved fork, NOT an oversight.
//   Unlike Election's linkOnChainElection, there's no backend-tracked
//   "just linked" timestamp here to build a sync-pending grace window
//   from (Candidate has no draft/link step at all, per this module's own
//   KEY DESIGN FACT above), and the realistic workflow - an admin adding
//   a candidate on-chain and immediately setting its bio in the same
//   sitting, since bios must be set before voting starts - makes a
//   mirror-only check meaningfully likely to wrongly 404 a candidate
//   that was just added moments ago. A live read costs one extra RPC
//   call on this single, low-traffic, admin-only write path; that's a
//   better trade than a spurious 404 blocking an admin's immediate next
//   action.
//
// AUTHORIZATION: the profile-edit endpoint is gated by requireAuth AND
// requireRole(ELECTION_ADMINISTRATOR_ROLE) at the route layer
// (candidate.routes.ts) - HANDOFF.md's "Newly discovered pre-frontend
// items", item 1. Previously requireAuth-only; this write has no
// on-chain step at all to fall back on (bios live only in Mongo), so any
// authenticated wallet could previously overwrite any candidate's public
// bio in any election.
//
// FAIRNESS RULE (approved design fork): bio edits are blocked once
// voting has started for that election, mirroring
// Election.sol's own addCandidate() timing restriction
// (CannotAddCandidateAfterVotingStarts) for the same reason - allowing
// an admin to rewrite a candidate's story mid-vote could sway undecided
// voters differently than it swayed early voters, a fairness problem
// analogous to (though on-chain, less clear-cut than) mid-vote candidate
// list changes.

import { HttpError } from "../../shared/httpError.js";
import { BlockchainError } from "../blockchain/index.js";
import type { IElectionContractClient } from "../blockchain/index.js";
import { resolveIpfsUrl } from "../ipfs/index.js";
import { CandidateProfileModel } from "./candidate.model.js";
import { IndexedElectionModel } from "../indexing/indexedElection.model.js";
import { IndexedCandidateModel } from "../indexing/indexedCandidate.model.js";
import type { CandidateSummary } from "./candidate.types.js";
import type { ElectionData } from "../blockchain/index.js";

export interface SetProfileInput {
  electionId: number;
  candidateId: number;
  bio: string;
  updatedBy: string;
}

/**
 * metadataURI is a direct image CID (approved IPFS-module design
 * decision - see modules/ipfs/IIpfsClient.ts's header comment); an empty
 * string means no image has been uploaded for this candidate yet.
 */
function imageUrlFor(metadataURI: string): string | null {
  return metadataURI.length > 0 ? resolveIpfsUrl(metadataURI) : null;
}

async function fetchElectionOrThrow(electionId: number, client: IElectionContractClient): Promise<ElectionData> {
  try {
    return await client.getElection(BigInt(electionId));
  } catch (error) {
    if (error instanceof BlockchainError && error.revertErrorName === "ElectionDoesNotExist") {
      throw new HttpError(404, "ELECTION_NOT_FOUND", `No election found with on-chain id ${electionId}.`);
    }
    throw error;
  }
}

export async function listCandidates(electionId: number): Promise<CandidateSummary[]> {
  const electionMirror = await IndexedElectionModel.findOne({ electionId });
  // Same "missing = not yet found" treatment Election's own module uses
  // for a partial/absent mirror doc - see election.service.ts's
  // fetchMirroredElection. No SYNC_PENDING distinction is needed here:
  // by the time a client requests this election's candidates, it must
  // already have fetched the election itself via the also-migrated
  // GET /elections, which already required a fully-synced mirror - so
  // hitting an unsynced-but-real election here is far less likely than
  // Election's own just-linked race.
  if (!electionMirror) {
    throw new HttpError(404, "ELECTION_NOT_FOUND", `No election found with on-chain id ${electionId}.`);
  }

  const profiles = await CandidateProfileModel.find({ electionId });
  const bioByCandidateId = new Map<number, string>(profiles.map((p) => [p.candidateId, p.bio]));

  const candidateDocs = await IndexedCandidateModel.find({ electionId, candidateId: { $in: electionMirror.candidateIds } });
  const candidateByCandidateId = new Map(candidateDocs.map((c) => [c.candidateId, c]));

  const summaries: CandidateSummary[] = [];
  for (const candidateId of electionMirror.candidateIds) {
    const candidate = candidateByCandidateId.get(candidateId);
    // Defensive skip, not an error: IndexedElection.candidateIds and
    // IndexedCandidate are written by two separate awaited calls within
    // the same event handler (see eventSync.ts's CandidateAdded branch)
    // - a process crash between those two awaits could in principle
    // leave a candidateId registered without its identity doc yet.
    // Self-corrects on the worker's next pass over that same log (still
    // within its checkpoint window) rather than needing a hard error
    // here.
    if (!candidate) continue;
    summaries.push({
      candidateId,
      name: candidate.name,
      metadataURI: candidate.metadataURI,
      bio: bioByCandidateId.get(candidateId) ?? null,
      imageUrl: imageUrlFor(candidate.metadataURI),
    });
  }
  return summaries.sort((a, b) => a.candidateId - b.candidateId);
}

export async function setCandidateProfile(input: SetProfileInput, client: IElectionContractClient): Promise<CandidateSummary> {
  const election = await fetchElectionOrThrow(input.electionId, client);

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (nowSeconds >= election.startTime) {
    throw new HttpError(
      409,
      "CANDIDATE_PROFILE_LOCKED",
      `Election ${input.electionId} has already started voting; candidate profiles can no longer be edited.`,
    );
  }

  let candidate;
  try {
    candidate = await client.getCandidate(BigInt(input.electionId), BigInt(input.candidateId));
  } catch (error) {
    if (error instanceof BlockchainError && error.revertErrorName === "CandidateDoesNotExist") {
      throw new HttpError(
        404,
        "CANDIDATE_NOT_FOUND",
        `No candidate ${input.candidateId} found for election ${input.electionId}. Add the candidate on-chain first.`,
      );
    }
    throw error;
  }

  await CandidateProfileModel.findOneAndUpdate(
    { electionId: input.electionId, candidateId: input.candidateId },
    { bio: input.bio, updatedBy: input.updatedBy },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return {
    candidateId: input.candidateId,
    name: candidate.name,
    metadataURI: candidate.metadataURI,
    bio: input.bio,
    imageUrl: imageUrlFor(candidate.metadataURI),
  };
}