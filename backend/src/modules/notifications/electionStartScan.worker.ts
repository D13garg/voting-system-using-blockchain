// BullMQ Worker processing the election-start-scan queue - gap #7.
//
// WHY THIS EXISTS AT ALL: Election.sol has no "voting opened" event - it
// only checks `block.timestamp >= startTime` lazily inside vote() (see
// contracts/contracts/Election.sol). There is nothing for eventSync.ts
// to react to. The only way to know voting has opened, or is about to,
// is to periodically compare wall-clock time against
// IndexedElectionModel's own startTime/endTime mirror (itself populated
// from ElectionCreated - see that model's header comment) - hence a
// scheduled scan rather than an event handler.
//
// DEDUP: startReminderSentAt/votingOpenNotifiedAt on IndexedElectionModel
// (see that file's header comment) are the source of truth for "already
// sent", read and set within runElectionStartScan below. This is a
// read-then-write, not an atomic findOneAndUpdate - acceptable because
// this codebase's own architecture (ADR-002) has exactly ONE worker
// process running eventSync.ts's poll loop and these BullMQ workers, so
// there is no concurrent second scan tick that could race it. If that
// single-worker-process assumption ever changes, this needs an atomic
// filter (e.g. `findOneAndUpdate({ startReminderSentAt: null }, { $set:
// ... })` and only proceeding to dispatch if a document was actually
// matched) - flagging here rather than silently building in a race.

import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { IndexedElectionModel } from "../indexing/indexedElection.model.js";
import { ELECTION_START_SCAN_QUEUE_NAME, type ElectionStartScanJobData } from "./electionStartScan.queue.js";
import {
  enqueueElectionStartingSoonNotifications,
  enqueueElectionStartingSoonWebhooks,
  enqueueVotingOpenNotifications,
  enqueueVotingOpenWebhooks,
} from "./notification.service.js";
import { env } from "../../config/env.js";

const workerLogger = logger.child({ service: "worker", queue: ELECTION_START_SCAN_QUEUE_NAME });

export function startElectionStartScanWorker(): Worker<ElectionStartScanJobData> {
  const worker = new Worker<ElectionStartScanJobData>(
    ELECTION_START_SCAN_QUEUE_NAME,
    async () => {
      await runElectionStartScan();
    },
    { connection: getRedisConnection() },
  );

  worker.on("failed", (job: Job<ElectionStartScanJobData> | undefined, err: Error) => {
    workerLogger.error({ err, jobId: job?.id }, "Election-start scan tick failed");
  });

  return worker;
}

/**
 * One scan tick. Exported separately from startElectionStartScanWorker
 * so it's directly unit-testable against real Mongoose models (via
 * mongodb-memory-server, same as every other DB-touching test in this
 * codebase) without needing a real BullMQ Worker/Redis connection - see
 * electionStartScan.test.ts.
 *
 * `now` defaults to the real clock but is an explicit parameter so tests
 * can pin it deterministically rather than racing real wall-clock time
 * against fixed startTime/endTime fixtures.
 */
export async function runElectionStartScan(now: Date = new Date()): Promise<void> {
  const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
  const leadWindowEndSeconds = BigInt(
    Math.floor((now.getTime() + env.ELECTION_START_REMINDER_LEAD_TIME_MS) / 1000),
  );

  const startingSoon = await IndexedElectionModel.find({
    startTime: { $exists: true, $gt: nowSeconds, $lte: leadWindowEndSeconds },
    startReminderSentAt: null,
  }).lean();

  for (const election of startingSoon) {
    const title = election.title ?? `Election #${election.electionId}`;
    await enqueueElectionStartingSoonNotifications(election.electionId, title);
    await enqueueElectionStartingSoonWebhooks(election.electionId, title);
    await IndexedElectionModel.updateOne(
      { electionId: election.electionId },
      { $set: { startReminderSentAt: now } },
    );
  }

  const votingNowOpen = await IndexedElectionModel.find({
    startTime: { $exists: true, $lte: nowSeconds },
    endTime: { $exists: true, $gt: nowSeconds },
    votingOpenNotifiedAt: null,
  }).lean();

  for (const election of votingNowOpen) {
    const title = election.title ?? `Election #${election.electionId}`;
    await enqueueVotingOpenNotifications(election.electionId, title);
    await enqueueVotingOpenWebhooks(election.electionId, title);
    await IndexedElectionModel.updateOne(
      { electionId: election.electionId },
      { $set: { votingOpenNotifiedAt: now } },
    );
  }
}