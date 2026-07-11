// Election-start scan job queue (BullMQ, Section 8) - gap #7. The FIRST
// scheduled (wall-clock, not event-reactive) trigger in this codebase -
// see electionStartScan.worker.ts's own header comment for why nothing
// on-chain can tell the worker "voting has opened".
//
// DELIBERATELY its own queue, not folded into notification-dispatch or
// webhook-dispatch (gap #4): those are per-recipient DELIVERY jobs
// (approved forked decision, gap #4 - one job per (electionId, wallet)
// pair). This is a single recurring SCAN job with no recipient of its
// own - it reads Mongo, decides who (if anyone) needs a message this
// tick, and enqueues into those existing delivery queues itself (see
// notification.service.ts's enqueueElectionStartingSoonNotifications/
// enqueueVotingOpenNotifications). Mixing a repeatable scan job into a
// per-recipient delivery queue would make that queue's job count no
// longer mean "one email/webhook in flight", breaking the mental model
// notification.queue.ts/webhook.queue.ts's own header comments rely on.

import { Queue } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";
import { env } from "../../config/env.js";
import type { IJobQueue } from "./notification.queue.js";

export const ELECTION_START_SCAN_QUEUE_NAME = "election-start-scan";

export type ElectionStartScanJobData = Record<string, never>;

let electionStartScanQueue: IJobQueue<ElectionStartScanJobData> | undefined;

function getElectionStartScanQueue(): IJobQueue<ElectionStartScanJobData> {
  electionStartScanQueue ??= new Queue<ElectionStartScanJobData>(ELECTION_START_SCAN_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return electionStartScanQueue;
}

/**
 * Registers the recurring scan job. Called once from worker.ts's
 * bootstrap(). Idempotent across repeated calls/restarts: BullMQ
 * upserts a repeatable job keyed by jobId + its repeat options, so
 * calling this again (e.g. every worker process restart) reschedules
 * the SAME repeatable job rather than accumulating duplicates - unlike
 * enqueueNotification/enqueueWebhook's one-shot jobId dedup, which
 * guards against redelivery of a single event, this guards against
 * "don't end up with two independent tickers".
 */
export async function scheduleElectionStartScan(): Promise<void> {
  await getElectionStartScanQueue().add(
    "scan",
    {},
    {
      jobId: "election-start-scan",
      repeat: { every: env.ELECTION_START_SCAN_INTERVAL_MS },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

/** Test-only seam. Never called from non-test code. */
export function _setElectionStartScanQueueForTests(queue: IJobQueue<ElectionStartScanJobData> | undefined): void {
  electionStartScanQueue = queue;
}