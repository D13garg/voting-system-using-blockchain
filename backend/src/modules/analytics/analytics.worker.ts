// BullMQ Worker processing the analytics-rollup queue. Started only from
// worker/worker.ts's bootstrap() - never imported by any test (same
// convention worker/worker.ts's own header comment already establishes
// for the poll-loop entrypoint itself), so a real Redis connection is
// only ever opened by an actual running worker process, never by a test
// run.

import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { ANALYTICS_ROLLUP_QUEUE_NAME, type AnalyticsRollupJobData } from "./analytics.queue.js";
import { recomputeRollup } from "./analytics.service.js";

const workerLogger = logger.child({ service: "worker", queue: ANALYTICS_ROLLUP_QUEUE_NAME });

export function startAnalyticsRollupWorker(): Worker<AnalyticsRollupJobData> {
  const worker = new Worker<AnalyticsRollupJobData>(
    ANALYTICS_ROLLUP_QUEUE_NAME,
    async (job: Job<AnalyticsRollupJobData>) => {
      await recomputeRollup(job.data.electionId);
    },
    { connection: getRedisConnection() },
  );

  worker.on("failed", (job, err) => {
    workerLogger.error({ err, jobId: job?.id, electionId: job?.data.electionId }, "Analytics rollup job failed");
  });

  return worker;
}