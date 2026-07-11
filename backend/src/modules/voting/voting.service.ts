// Voting module service layer (architecture Section 7.1). All real logic
// lives here, not in voting.routes.ts (same principle as every other
// module's service layer).
//
// READ STRATEGY (updated - decision (a), Phase 6 follow-up): the vote
// tally itself is no longer a live per-candidate chain read. It's now a
// MongoDB aggregation over IndexedVoteEvent (populated by the worker -
// see modules/indexing/), grouped by candidateId, which is exactly the
// query that collection was built for (architecture Section 10). This
// removes the previous dependency on the contract's own per-candidate
// voteCount field for this endpoint entirely - a candidate's voteCount as
// read via getCandidate() is no longer consulted or trusted here.
//
// Candidate identity (name/metadataURI) is NOT part of this migration -
// see the architecture doc's Section 10/11 note (added when reconciling
// the Candidate module's schema divergence): those fields have no
// indexed mirror yet (IndexedChainEvent's CandidateAdded records are a
// generic, unstructured audit log, not a queryable identity source), so
// getCandidate() is still called once per candidate for name/metadataURI
// only. A future pass can migrate that too, once a real name/metadataURI
// mirror exists - not bundled into this one.
//
// DELIBERATELY NOT BUILT HERE (see voting.types.ts's header comment):
// - Per-voter "which candidate did address X vote for" - the contract's
//   hasVoted() is boolean-only; getting the actual candidateId requires
//   reading the historical VoteCast event log. Now that IndexedVoteEvent
//   exists, this is a simple query against it (find one document by
//   {electionId, voterAddress}) - still not built here, out of this
//   pass's scope (only /results was approved), but no longer blocked on
//   anything.
// - Resolving a candidate's metadataURI into an actual image - that's
//   the not-yet-built IPFS module's job. Results below return the raw
//   URI string.

import { HttpError } from "../../shared/httpError.js";
import { BlockchainError } from "../blockchain/index.js";
import type { IElectionContractClient } from "../blockchain/index.js";
import { IndexedVoteEventModel } from "../indexing/indexedVoteEvent.model.js";
import type { CandidateResult, ElectionResults } from "./voting.types.js";

/**
 * Re-throws a BlockchainError's ElectionDoesNotExist revert as a proper
 * HttpError(404) - the same translation election.service.ts's
 * fetchOnChainData does, kept local to this module rather than shared
 * because each module's 404 message differs and there are currently only
 * two call sites total across both modules combined.
 */
function rethrowAsNotFound(error: unknown, electionId: number): never {
  if (error instanceof BlockchainError && error.revertErrorName === "ElectionDoesNotExist") {
    throw new HttpError(404, "ELECTION_NOT_FOUND", `No on-chain election found with electionId ${electionId}.`);
  }
  throw error;
}

export async function getElectionResults(
  electionId: number,
  client: IElectionContractClient,
): Promise<ElectionResults> {
  let candidateCount: bigint;
  try {
    const election = await client.getElection(BigInt(electionId));
    candidateCount = election.candidateCount;
  } catch (error) {
    rethrowAsNotFound(error, electionId);
  }

  const tallies = await IndexedVoteEventModel.aggregate<{ _id: number; count: number }>([
    { $match: { electionId } },
    { $group: { _id: "$candidateId", count: { $sum: 1 } } },
  ]);
  const voteCountByCandidateId = new Map<number, number>(tallies.map((t) => [t._id, t.count]));

  const candidates: CandidateResult[] = await Promise.all(
    Array.from({ length: Number(candidateCount) }, async (_, candidateId) => {
      const candidate = await client.getCandidate(BigInt(electionId), BigInt(candidateId));
      return {
        candidateId,
        name: candidate.name,
        metadataURI: candidate.metadataURI,
        voteCount: voteCountByCandidateId.get(candidateId) ?? 0,
      };
    }),
  );

  return {
    electionId,
    totalVotes: candidates.reduce((sum, c) => sum + c.voteCount, 0),
    candidates,
  };
}

/**
 * Whether `voter` has already voted in `electionId`. Unlike the
 * contract's own hasVoted() (which returns false for a nonexistent
 * election - a silent mapping default, not a real answer), this
 * explicitly validates the election exists first and 404s otherwise -
 * "no" and "there's nothing to ask about" are different answers, and an
 * API caller deserves to be able to tell them apart.
 */
export async function hasVoted(
  electionId: number,
  voter: `0x${string}`,
  client: IElectionContractClient,
): Promise<boolean> {
  try {
    await client.getElection(BigInt(electionId));
  } catch (error) {
    rethrowAsNotFound(error, electionId);
  }
  return client.hasVoted(BigInt(electionId), voter);
}