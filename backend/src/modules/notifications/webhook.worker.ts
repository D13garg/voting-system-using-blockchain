// BullMQ Worker processing the webhook-dispatch queue. Same "started
// only from worker/worker.ts's bootstrap(), so no test ever opens a real
// Redis connection through this file" convention as notification.worker.ts
// and analytics.worker.ts - see their header comments.
//
// DEFAULT SENDER: HttpWebhookSender (the real implementation) - same
// "default to the real thing, tests inject a fake" convention as
// notification.worker.ts defaulting to ResendNotificationSender.

import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { WEBHOOK_DISPATCH_QUEUE_NAME, type WebhookJobData } from "./webhook.queue.js";
import { HttpWebhookSender } from "./HttpWebhookSender.js";
import type { IWebhookSender } from "./IWebhookSender.js";

const workerLogger = logger.child({ service: "worker", queue: WEBHOOK_DISPATCH_QUEUE_NAME });

export function startWebhookWorker(sender: IWebhookSender = new HttpWebhookSender()): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    WEBHOOK_DISPATCH_QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      await sender.send(job.data);
    },
    { connection: getRedisConnection() },
  );

  worker.on("failed", (job, err) => {
    workerLogger.error({ err, jobId: job?.id, url: job?.data.url }, "Webhook dispatch job failed");
  });

  return worker;
}
