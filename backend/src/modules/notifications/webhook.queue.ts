// Webhook dispatch job queue (BullMQ, Section 8) - a DEDICATED queue,
// separate from notification.queue.ts's notification-dispatch (approved
// forked decision, gap #4): an unreachable/slow third-party webhook
// endpoint retrying with its own backoff must never share a queue (and
// therefore worker concurrency/backpressure) with email delivery, whose
// failure modes and provider (Resend) are entirely unrelated.
//
// Otherwise identical pattern to notification.queue.ts: one job per
// (electionId, recipient) pair, jobId = `webhook:${electionId}:${wallet}`
// for the same at-least-once-delivery dedup reason (see that file's
// header comment). Reuses its exported IJobQueue<T> test-seam interface
// rather than redefining an identical one here.

import { Queue } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";
import type { IJobQueue } from "./notification.queue.js";
import type { WebhookDispatchInput } from "./IWebhookSender.js";

export const WEBHOOK_DISPATCH_QUEUE_NAME = "webhook-dispatch";

export type WebhookJobData = WebhookDispatchInput;

let webhookDispatchQueue: IJobQueue<WebhookJobData> | undefined;

function getWebhookDispatchQueue(): IJobQueue<WebhookJobData> {
  webhookDispatchQueue ??= new Queue<WebhookJobData>(WEBHOOK_DISPATCH_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return webhookDispatchQueue;
}

export async function enqueueWebhook(input: WebhookJobData, jobId: string): Promise<void> {
  await getWebhookDispatchQueue().add("dispatch", input, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

/** Test-only seam. Never called from non-test code. */
export function _setWebhookDispatchQueueForTests(queue: IJobQueue<WebhookJobData> | undefined): void {
  webhookDispatchQueue = queue;
}
