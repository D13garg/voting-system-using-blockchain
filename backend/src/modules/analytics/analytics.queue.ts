// Analytics rollup job queue (BullMQ, Section 8). Enqueuing happens from
// eventSync.ts (the worker's single writer of IndexedVoteEvent/
// IndexedElection) right after each relevant write - see
// analytics.model.ts's header comment and
// docs/architecture/ADR/ADR-007-analytics-trigger-direct-enqueue.md for
// why this replaces the architecture doc's original "MongoDB Change
// Streams" wording.
//
// IJobQueue<T> is a deliberately minimal interface covering only the one
// BullMQ Queue method this module actually calls. Same test-seam
// rationale as every external-system client in this codebase
// (IIpfsClient, IElectionContractClient, ...): eventSync.test.ts can
// inject a fake object satisfying this interface via
// _setAnalyticsRollupQueueForTests, so exercising VoteCast/
// ElectionFinalized handling in tests never opens a real Redis
// connection - Redis is only ever touched by the real worker process
// (worker/worker.ts) and analytics.worker.ts, never by anything a test
// imports.
//
// jobId = `rollup:${electionId}` is the dedup mechanism: BullMQ treats
// add() with an already-waiting/active/delayed job of the same ID as a
// no-op returning the existing job, so a burst of VoteCast events for
// the same election collapses into a single pending recompute rather
// than one job per vote. removeOnComplete means a finished job's ID
// frees up immediately, so the next vote for that election can enqueue
// a fresh recompute.

import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";

export const ANALYTICS_ROLLUP_QUEUE_NAME = "analytics-rollup";

export interface AnalyticsRollupJobData {
  electionId: number;
}

export interface IJobQueue<T> {
  add(name: string, data: T, opts: JobsOptions): Promise<unknown>;
}

let analyticsRollupQueue: IJobQueue<AnalyticsRollupJobData> | undefined;

function getAnalyticsRollupQueue(): IJobQueue<AnalyticsRollupJobData> {
  analyticsRollupQueue ??= new Queue<AnalyticsRollupJobData>(ANALYTICS_ROLLUP_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return analyticsRollupQueue;
}

export async function enqueueRollupRecompute(electionId: number): Promise<void> {
  await getAnalyticsRollupQueue().add(
    "recompute",
    { electionId },
    { jobId: `rollup:${electionId}`, removeOnComplete: true, removeOnFail: 100 },
  );
}

/** Test-only seam. Never called from non-test code. */
export function _setAnalyticsRollupQueueForTests(queue: IJobQueue<AnalyticsRollupJobData> | undefined): void {
  analyticsRollupQueue = queue;
}