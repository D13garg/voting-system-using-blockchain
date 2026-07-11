// BullMQ Worker processing the notification-dispatch queue. Started only
// from worker/worker.ts's bootstrap() - see analytics.worker.ts's header
// comment for why that means no test ever opens a real Redis connection
// through this file.
//
// DEFAULT SENDER: ResendNotificationSender (the real implementation) -
// same "default to the real thing, tests inject a fake" convention as
// modules/ipfs/index.ts's getIpfsClient defaulting to PinataIpfsClient.
// A deployer without a Resend account configured can swap in
// ConsoleNotificationSender instead by passing it to startNotificationWorker.

import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { NOTIFICATION_DISPATCH_QUEUE_NAME, type NotificationJobData } from "./notification.queue.js";
import { ResendNotificationSender } from "./ResendNotificationSender.js";
import type { INotificationSender } from "./INotificationSender.js";

const workerLogger = logger.child({ service: "worker", queue: NOTIFICATION_DISPATCH_QUEUE_NAME });

export function startNotificationWorker(
  sender: INotificationSender = new ResendNotificationSender(),
): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_DISPATCH_QUEUE_NAME,
    async (job: Job<NotificationJobData>) => {
      await sender.send(job.data);
    },
    { connection: getRedisConnection() },
  );

  worker.on("failed", (job, err) => {
    workerLogger.error({ err, jobId: job?.id, to: job?.data.to }, "Notification dispatch job failed");
  });

  return worker;
}