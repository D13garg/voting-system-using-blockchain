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
import type { Worker } from "bullmq";

const workerLogger = logger.child({ service: "worker" });

let pollTimer: NodeJS.Timeout | undefined;
let pollInFlight = false;
let analyticsRollupWorker: Worker | undefined;
let notificationDispatchWorker: Worker | undefined;

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
    pollInFlight = false;
  }
}

async function bootstrap(): Promise<void> {
  await connectDatabase();
  workerLogger.info("Worker process started");

  analyticsRollupWorker = startAnalyticsRollupWorker();
  notificationDispatchWorker = startNotificationWorker();

  // Run one pass immediately rather than waiting a full interval before
  // the first sync - a freshly (re)started worker catching up on a
  // backlog shouldn't sit idle for RECOMMENDED_POLL_INTERVAL_MS first.
  await pollOnce();
  pollTimer = setInterval(() => void pollOnce(), RECOMMENDED_POLL_INTERVAL_MS);
}

async function shutdown(signal: string): Promise<void> {
  workerLogger.info({ signal }, "Worker process shutting down");
  if (pollTimer) clearInterval(pollTimer);
  await Promise.all([analyticsRollupWorker?.close(), notificationDispatchWorker?.close()]);
  await disconnectDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

bootstrap().catch((err: unknown) => {
  workerLogger.error({ err }, "Worker process failed to start");
  process.exit(1);
});