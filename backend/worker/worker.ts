// Worker process entrypoint (ADR-002: independently deployed from the API
// process in src/app.ts).
//
// This is the ONLY process that listens for blockchain events and the ONLY
// writer of chain-derived MongoDB collections (IndexedVoteEvent,
// IndexedChainEvent, AnalyticsRollup) — see ADR-002 and ADR-003. It shares
// the exact same Mongoose model definitions as the API process to
// guarantee no schema drift between writer and reader.
//
// Phase 6 (event listening, below): event listening via
// src/modules/indexing/eventSync.ts, on a simple setInterval poll loop -
// not BullMQ.
//
// Phase 7(b) (added after the note above was first written): BullMQ/
// Redis-backed job queues now DO exist - analytics.worker.ts and
// notification.worker.ts, started below alongside the poll loop. The
// poll loop remains the ONLY thing that listens for blockchain events and
// writes chain-derived MongoDB collections (IndexedVoteEvent,
// IndexedChainEvent, IndexedElection, ...) - see ADR-002/ADR-003; the two
// BullMQ workers only ever react to jobs that eventSync.ts enqueues after
// its own writes, they never touch the chain or read logs themselves.
//
// Gap #4 (webhook notifications): a THIRD BullMQ worker, webhook.worker.ts,
// added below alongside the other two - same "only reacts to jobs
// eventSync.ts enqueues" property, deliberately its own queue/worker
// rather than folded into notification.worker.ts (see webhook.queue.ts's
// header comment for why).
//
// Gap #7 (election-start reminder): a FOURTH BullMQ worker/queue pair,
// electionStartScan.worker.ts/electionStartScan.queue.ts, is different in
// kind from the other three - it does NOT react to a job eventSync.ts
// enqueues. It's a repeatable job (registered once via
// scheduleElectionStartScan() below) that fires on its own wall-clock
// schedule and does its own IndexedElectionModel reads - the first thing
// in this file that isn't purely reactive to chain events or other
// workers' output. See electionStartScan.worker.ts's header comment for
// why nothing here can react to an on-chain "voting opened" event (there
// isn't one).
//
// NOTE on the unconditional bootstrap() call below (unlike src/app.ts,
// which needed an env.NODE_ENV !== "test" guard around its own
// listen()-on-import side effect): this file is never imported by any
// test - tests import src/modules/indexing/eventSync.ts and the Mongoose
// models directly, exercising the real sync logic against a fake
// PublicClient without ever loading this entrypoint file. If that ever
// changes, apply the same guard pattern app.ts uses.

import { connectDatabase, disconnectDatabase } from "../src/db/connection.js";
import { logger } from "../src/shared/logger.js";
import { syncAllEvents } from "../src/modules/indexing/eventSync.js";
import { RECOMMENDED_POLL_INTERVAL_MS } from "../src/modules/blockchain/events.js";
import { startAnalyticsRollupWorker } from "../src/modules/analytics/analytics.worker.js";
import { startNotificationWorker } from "../src/modules/notifications/notification.worker.js";
import { startWebhookWorker } from "../src/modules/notifications/webhook.worker.js";
import { scheduleElectionStartScan } from "../src/modules/notifications/electionStartScan.queue.js";
import { startElectionStartScanWorker } from "../src/modules/notifications/electionStartScan.worker.js";
import { WorkerCheckpointModel } from "../src/modules/indexing/checkpoint.model.js";
import {
  evaluateStall,
  initialStallDetectorState,
  type StallDetectorState,
} from "../src/modules/indexing/stallDetector.js";
import { env } from "../src/config/env.js";
import type { Worker } from "bullmq";

const workerLogger = logger.child({ service: "worker" });

let pollTimer: NodeJS.Timeout | undefined;
let pollInFlight = false;
let analyticsRollupWorker: Worker | undefined;
let notificationDispatchWorker: Worker | undefined;
let webhookDispatchWorker: Worker | undefined;
let electionStartScanWorker: Worker | undefined;
// Re-initialized with a fresh `now` at the top of bootstrap() below, so a
// (re)started worker's stall clock starts from actual process-start time,
// not module-import time.
let stallState: StallDetectorState = initialStallDetectorState(Date.now());

/**
 * Gap #5 (stalled-worker CRITICAL alert, architecture Section 17). Reads
 * the current max checkpoint block already written to Mongo by this same
 * poll cycle's syncAllEvents() call (or whatever the last successful
 * write was, if this cycle itself failed before writing anything) and
 * feeds it to the pure evaluateStall() state machine. Runs after every
 * poll attempt regardless of success/failure - see stallDetector.ts's
 * header comment for why a fully-down RPC provider is exactly the case
 * this must catch, not just per-event sync errors.
 */
async function checkForWorkerStall(): Promise<void> {
  let currentMaxBlock: bigint | null = null;
  try {
    const latest = await WorkerCheckpointModel.findOne().sort({ lastProcessedBlock: -1 }).lean();
    currentMaxBlock = latest?.lastProcessedBlock ?? null;
  } catch (err) {
    // A failure to even read the checkpoint collection (e.g. Mongo
    // connectivity) is itself worth knowing about, but must not crash the
    // poll loop or corrupt stallState - skip this cycle's evaluation and
    // let the next one retry the read.
    workerLogger.error({ err }, "Failed to read worker checkpoints for stall detection");
    return;
  }

  const result = evaluateStall(stallState, currentMaxBlock, Date.now(), env.WORKER_STALL_CRITICAL_MS);
  stallState = result.nextState;

  if (result.shouldLogStall) {
    workerLogger.fatal(
      { currentMaxBlock: currentMaxBlock?.toString() ?? null, stalledForMs: result.stalledForMs },
      `Worker has not processed a new block in over ${env.WORKER_STALL_CRITICAL_MS}ms`,
    );
  } else if (result.shouldLogRecovery) {
    workerLogger.info(
      { currentMaxBlock: currentMaxBlock?.toString() ?? null },
      "Worker checkpoint is advancing again; stall condition cleared",
    );
  }
}

async function pollOnce(): Promise<void> {
  // Guards against a poll cycle overlapping with itself if one run ever
  // takes longer than RECOMMENDED_POLL_INTERVAL_MS (e.g. an RPC provider
  // having a slow moment) - setInterval does not wait for its callback's
  // promise to settle before scheduling the next tick.
  if (pollInFlight) {
    workerLogger.warn("Previous poll cycle still running; skipping this tick");
    return;
  }
  pollInFlight = true;
  try {
    const results = await syncAllEvents();
    workerLogger.info({ results }, "Completed one event-sync poll cycle");
  } catch (err) {
    // syncAllEvents already isolates and logs each event definition's own
    // failures internally - reaching this catch means something failed
    // outside that per-event isolation (e.g. the RPC client itself
    // couldn't be constructed), worth its own log line.
    workerLogger.error({ err }, "Unexpected error during event-sync poll cycle");
  } finally {
    await checkForWorkerStall();
    pollInFlight = false;
  }
}

async function bootstrap(): Promise<void> {
  await connectDatabase();
  workerLogger.info("Worker process started");
  stallState = initialStallDetectorState(Date.now());

  analyticsRollupWorker = startAnalyticsRollupWorker();
  notificationDispatchWorker = startNotificationWorker();
  webhookDispatchWorker = startWebhookWorker();
  electionStartScanWorker = startElectionStartScanWorker();
  // Idempotent - see scheduleElectionStartScan's own header comment on
  // why calling this again on every bootstrap/restart is safe (BullMQ
  // upserts the repeatable job by its jobId + repeat options, it doesn't
  // accumulate a second independent ticker).
  await scheduleElectionStartScan();

  // Run one pass immediately rather than waiting a full interval before
  // the first sync - a freshly (re)started worker catching up on a
  // backlog shouldn't sit idle for RECOMMENDED_POLL_INTERVAL_MS first.
  await pollOnce();
  pollTimer = setInterval(() => void pollOnce(), RECOMMENDED_POLL_INTERVAL_MS);
}

async function shutdown(signal: string): Promise<void> {
  workerLogger.info({ signal }, "Worker process shutting down");
  if (pollTimer) clearInterval(pollTimer);
  await Promise.all([
    analyticsRollupWorker?.close(),
    notificationDispatchWorker?.close(),
    webhookDispatchWorker?.close(),
    electionStartScanWorker?.close(),
  ]);
  await disconnectDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

bootstrap().catch((err: unknown) => {
  workerLogger.error({ err }, "Worker process failed to start");
  process.exit(1);
});