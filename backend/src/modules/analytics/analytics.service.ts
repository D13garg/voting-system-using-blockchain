// Analytics module service layer. recomputeRollup is called exclusively
// from analytics.worker.ts (a BullMQ job processor, itself enqueued from
// eventSync.ts - see analytics.queue.ts's header comment); getAnalytics
// is called exclusively from analytics.routes.ts. Neither function
// touches Redis/BullMQ directly, only Mongoose models - this is what
// lets analytics.test.ts exercise both with real in-memory MongoDB and
// zero Redis dependency.

import { HttpError } from "../../shared/httpError.js";
import { IndexedElectionModel } from "../indexing/indexedElection.model.js";
import { IndexedVoteEventModel } from "../indexing/indexedVoteEvent.model.js";
import { IndexedVoterRegistrationModel } from "../indexing/indexedVoterRegistration.model.js";
import { AnalyticsRollupModel } from "./analytics.model.js";
import type { AnalyticsRollupSummary } from "./analytics.types.js";

/**
 * Recomputes and persists the full AnalyticsRollup for one election from
 * scratch, reading every IndexedVoteEvent row for it.
 *
 * FULL RECOMPUTE, NOT INCREMENTAL (deliberate simplicity choice): every
 * call re-reads and re-aggregates the election's entire vote history,
 * rather than incrementing counters in place. This is correctness-first
 * and idempotent by construction - re-running it after a duplicate
 * enqueue (or a retried job) always converges to the same answer, with
 * no drift-accumulation risk an incremental counter approach would carry
 * under at-least-once job delivery. The realistic vote counts for a
 * project at this scale make an O(votes) scan per recompute a non-issue;
 * if a future need for very-high-volume elections changes that
 * calculus, incremental counters become worth the added complexity then.
 */
export async function recomputeRollup(electionId: number): Promise<void> {
  const voteEvents = await IndexedVoteEventModel.find({ electionId }).sort({ timestamp: 1 }).lean();

  const votesByCandidate = new Map<string, number>();
  const participationOverTime: { timestamp: Date; cumulativeVotes: number }[] = [];
  let cumulativeVotes = 0;
  let lastUpdatedFromBlock: bigint | undefined;

  for (const event of voteEvents) {
    const key = String(event.candidateId);
    votesByCandidate.set(key, (votesByCandidate.get(key) ?? 0) + 1);
    cumulativeVotes += 1;
    participationOverTime.push({ timestamp: event.timestamp, cumulativeVotes });
    if (lastUpdatedFromBlock === undefined || event.blockNumber > lastUpdatedFromBlock) {
      lastUpdatedFromBlock = event.blockNumber;
    }
  }

  const registeredVoterCount = await IndexedVoterRegistrationModel.countDocuments({
    electionId,
    registered: true,
  });
  // registeredVoterCount === 0 guard: a brand-new election with no
  // registered voters yet has an undefined, not zero, turnout rate -
  // reporting 0% here (rather than NaN/Infinity from a 0-denominator
  // division) is the safer, still-accurate-enough default.
  const turnoutPercent = registeredVoterCount > 0 ? (cumulativeVotes / registeredVoterCount) * 100 : 0;

  await AnalyticsRollupModel.findOneAndUpdate(
    { onchainElectionId: electionId },
    {
      onchainElectionId: electionId,
      totalVotes: cumulativeVotes,
      turnoutPercent,
      votesByCandidate,
      participationOverTime,
      lastUpdatedFromBlock,
    },
    { upsert: true },
  );
}

export async function getAnalytics(electionId: number): Promise<AnalyticsRollupSummary> {
  const electionMirror = await IndexedElectionModel.findOne({ electionId });
  if (!electionMirror) {
    throw new HttpError(404, "ELECTION_NOT_FOUND", `No election found with on-chain id ${electionId}.`);
  }

  const rollup = await AnalyticsRollupModel.findOne({ onchainElectionId: electionId });
  if (!rollup) {
    // No votes have been indexed for this election yet - a real,
    // zeroed answer (not an error; the election itself does exist).
    return {
      onchainElectionId: electionId,
      totalVotes: 0,
      turnoutPercent: 0,
      votesByCandidate: {},
      participationOverTime: [],
      lastUpdatedFromBlock: null,
    };
  }

  return {
    onchainElectionId: rollup.onchainElectionId,
    totalVotes: rollup.totalVotes,
    turnoutPercent: rollup.turnoutPercent,
    votesByCandidate: Object.fromEntries(rollup.votesByCandidate),
    participationOverTime: rollup.participationOverTime.map((point) => ({
      timestamp: point.timestamp.toISOString(),
      cumulativeVotes: point.cumulativeVotes,
    })),
    lastUpdatedFromBlock: rollup.lastUpdatedFromBlock !== undefined ? rollup.lastUpdatedFromBlock.toString() : null,
  };
}