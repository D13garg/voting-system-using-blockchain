// Notification dispatch job queue (BullMQ, Section 8). One job per
// (electionId, recipient) pair, enqueued from
// notification.service.ts's dispatchElectionFinalizedNotifications
// (itself called from eventSync.ts's ElectionFinalized handling) - per-
// recipient jobs, rather than one job that fans out to every recipient
// internally, so BullMQ's own retry/backoff applies independently per
// recipient: one slow or failing inbox retries on its own without
// blocking or re-sending to every other subscriber.
//
// jobId = `notify:${electionId}:${walletAddress}` is the same dedup
// mechanism as analytics.queue.ts's rollup:${electionId} - guards
// against a redelivered ElectionFinalized log (at-least-once delivery,
// see modules/blockchain/events.ts) re-enqueuing a duplicate email to
// the same recipient for the same election.
//
// See analytics.queue.ts's header comment for the full rationale behind
// IJobQueue<T> as a minimal test-seam interface - same pattern, same
// reason: eventSync.test.ts and notification.test.ts inject a fake
// queue, never opening a real Redis connection.

import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "../../shared/redis.js";
import type { NotificationInput } from "./INotificationSender.js";

export const NOTIFICATION_DISPATCH_QUEUE_NAME = "notification-dispatch";

export type NotificationJobData = NotificationInput;

export interface IJobQueue<T> {
  add(name: string, data: T, opts: JobsOptions): Promise<unknown>;
}

let notificationDispatchQueue: IJobQueue<NotificationJobData> | undefined;

function getNotificationDispatchQueue(): IJobQueue<NotificationJobData> {
  notificationDispatchQueue ??= new Queue<NotificationJobData>(NOTIFICATION_DISPATCH_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return notificationDispatchQueue;
}

export async function enqueueNotification(input: NotificationInput, jobId: string): Promise<void> {
  await getNotificationDispatchQueue().add("dispatch", input, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

/** Test-only seam. Never called from non-test code. */
export function _setNotificationDispatchQueueForTests(queue: IJobQueue<NotificationJobData> | undefined): void {
  notificationDispatchQueue = queue;
}