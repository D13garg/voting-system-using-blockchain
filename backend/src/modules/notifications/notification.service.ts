// Notifications module service layer.

import { randomBytes } from "node:crypto";
import { HttpError } from "../../shared/httpError.js";
import { IndexedElectionModel } from "../indexing/indexedElection.model.js";
import { enqueueNotification } from "./notification.queue.js";
import { NotificationPreferenceModel } from "./notificationPreference.model.js";
import { enqueueWebhook } from "./webhook.queue.js";
import { WebhookPreferenceModel } from "./webhookPreference.model.js";

export interface SubscribeInput {
  electionId: number;
  walletAddress: string;
  email: string;
}

export async function subscribeToElectionNotifications(input: SubscribeInput): Promise<void> {
  const electionMirror = await IndexedElectionModel.findOne({ electionId: input.electionId });
  if (!electionMirror) {
    throw new HttpError(404, "ELECTION_NOT_FOUND", `No election found with on-chain id ${input.electionId}.`);
  }

  await NotificationPreferenceModel.findOneAndUpdate(
    { electionId: input.electionId, walletAddress: input.walletAddress.toLowerCase() },
    { $set: { email: input.email } },
    { upsert: true },
  );
}

export interface SubscribeWebhookInput {
  electionId: number;
  walletAddress: string;
  url: string;
}

/**
 * Gap #4. Same election-existence guard as subscribeToElectionNotifications.
 * Generates a fresh HMAC secret on every call (including re-subscribes
 * that only change the URL) - approved forked decision - and returns it
 * to the caller. This is the only time the secret is ever returned; the
 * WebhookPreference document is the only durable copy after this.
 */
export async function subscribeToElectionWebhook(input: SubscribeWebhookInput): Promise<{ secret: string }> {
  const electionMirror = await IndexedElectionModel.findOne({ electionId: input.electionId });
  if (!electionMirror) {
    throw new HttpError(404, "ELECTION_NOT_FOUND", `No election found with on-chain id ${input.electionId}.`);
  }

  const secret = randomBytes(32).toString("hex");
  await WebhookPreferenceModel.findOneAndUpdate(
    { electionId: input.electionId, walletAddress: input.walletAddress.toLowerCase() },
    { $set: { url: input.url, secret } },
    { upsert: true },
  );
  return { secret };
}

/**
 * Gap #7. A DEDICATED opt-in, deliberately separate from
 * subscribeToElectionNotifications/subscribeToElectionWebhook (approved
 * forked decision) - flips wantsStartReminders on whichever preference
 * row(s) the caller already has for this election, on EITHER or BOTH
 * channels. Does not itself create a new email/webhook registration -
 * "remind me before this starts" without an already-registered delivery
 * channel would have nowhere to deliver to, so this throws 404 if the
 * caller has subscribed to neither channel yet (see
 * notification.routes.ts's start-reminder-subscribe endpoint for the
 * exact error shape).
 */
export async function subscribeToElectionStartReminders(input: {
  electionId: number;
  walletAddress: string;
}): Promise<void> {
  const wallet = input.walletAddress.toLowerCase();

  const emailResult = await NotificationPreferenceModel.updateOne(
    { electionId: input.electionId, walletAddress: wallet },
    { $set: { wantsStartReminders: true } },
  );
  const webhookResult = await WebhookPreferenceModel.updateOne(
    { electionId: input.electionId, walletAddress: wallet },
    { $set: { wantsStartReminders: true } },
  );

  if (emailResult.matchedCount === 0 && webhookResult.matchedCount === 0) {
    throw new HttpError(
      404,
      "NOT_SUBSCRIBED",
      "Subscribe to email or webhook notifications for this election first, then opt in to start reminders.",
    );
  }
}

function buildElectionFinalizedEmail(electionId: number, title: string): { subject: string; html: string } {
  return {
    subject: `Election "${title}" results are final`,
    html: `<p>The election <strong>${title}</strong> (#${electionId}) has been finalized. Results are now available.</p>`,
  };
}

function buildElectionFinalizedWebhookPayload(electionId: number, title: string): Record<string, unknown> {
  return {
    event: "election.finalized",
    electionId,
    title,
    finalizedAt: new Date().toISOString(),
  };
}

function buildElectionStartingSoonEmail(electionId: number, title: string): { subject: string; html: string } {
  return {
    subject: `Voting opens soon for "${title}"`,
    html: `<p>Voting for <strong>${title}</strong> (#${electionId}) opens soon. Get ready to cast your vote.</p>`,
  };
}

function buildElectionStartingSoonWebhookPayload(electionId: number, title: string): Record<string, unknown> {
  return {
    event: "election.starting_soon",
    electionId,
    title,
    checkedAt: new Date().toISOString(),
  };
}

function buildVotingOpenEmail(electionId: number, title: string): { subject: string; html: string } {
  return {
    subject: `Voting is now open for "${title}"`,
    html: `<p>Voting for <strong>${title}</strong> (#${electionId}) is now open. Cast your vote now.</p>`,
  };
}

function buildVotingOpenWebhookPayload(electionId: number, title: string): Record<string, unknown> {
  return {
    event: "election.voting_open",
    electionId,
    title,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Called from eventSync.ts once an ElectionFinalized event has been
 * processed. Looks up everyone subscribed to this election and enqueues
 * one dispatch job per recipient - see notification.queue.ts's header
 * comment for why per-recipient jobs, not one fan-out job.
 */
export async function enqueueElectionFinalizedNotifications(electionId: number, title: string): Promise<void> {
  const preferences = await NotificationPreferenceModel.find({ electionId }).lean();
  if (preferences.length === 0) return;

  const { subject, html } = buildElectionFinalizedEmail(electionId, title);
  for (const preference of preferences) {
    await enqueueNotification(
      { to: preference.email, subject, html },
      `notify:${electionId}:${preference.walletAddress}`,
    );
  }
}

/**
 * Webhook counterpart to enqueueElectionFinalizedNotifications, gap #4.
 * Called alongside it from eventSync.ts - see that file's ElectionFinalized
 * handling. Deliberately a fully separate lookup/enqueue path (own model,
 * own queue) rather than a branch inside the function above - see
 * webhookPreference.model.ts and webhook.queue.ts's header comments for
 * why the two channels are kept independent end to end.
 */
export async function enqueueElectionFinalizedWebhooks(electionId: number, title: string): Promise<void> {
  const preferences = await WebhookPreferenceModel.find({ electionId }).lean();
  if (preferences.length === 0) return;

  const payload = buildElectionFinalizedWebhookPayload(electionId, title);
  for (const preference of preferences) {
    await enqueueWebhook(
      { url: preference.url, secret: preference.secret, payload },
      `webhook:${electionId}:${preference.walletAddress}`,
    );
  }
}

/**
 * Gap #7. Called from electionStartScan.worker.ts's runElectionStartScan,
 * NOT from eventSync.ts - there is no chain event to react to (see that
 * worker file's header comment). Same per-recipient-job shape as
 * enqueueElectionFinalizedNotifications, filtered to
 * wantsStartReminders: true (existing finalized-only subscribers must
 * not suddenly start getting a notification type they never asked for).
 */
export async function enqueueElectionStartingSoonNotifications(electionId: number, title: string): Promise<void> {
  const preferences = await NotificationPreferenceModel.find({ electionId, wantsStartReminders: true }).lean();
  if (preferences.length === 0) return;

  const { subject, html } = buildElectionStartingSoonEmail(electionId, title);
  for (const preference of preferences) {
    await enqueueNotification(
      { to: preference.email, subject, html },
      `start-reminder:${electionId}:${preference.walletAddress}`,
    );
  }
}

/** Webhook counterpart to enqueueElectionStartingSoonNotifications - same split rationale as the finalized pair above. */
export async function enqueueElectionStartingSoonWebhooks(electionId: number, title: string): Promise<void> {
  const preferences = await WebhookPreferenceModel.find({ electionId, wantsStartReminders: true }).lean();
  if (preferences.length === 0) return;

  const payload = buildElectionStartingSoonWebhookPayload(electionId, title);
  for (const preference of preferences) {
    await enqueueWebhook(
      { url: preference.url, secret: preference.secret, payload },
      `start-reminder-webhook:${electionId}:${preference.walletAddress}`,
    );
  }
}

/** Voting-now-open counterpart to enqueueElectionStartingSoonNotifications - the second half of the "Both" firing decision, gap #7. */
export async function enqueueVotingOpenNotifications(electionId: number, title: string): Promise<void> {
  const preferences = await NotificationPreferenceModel.find({ electionId, wantsStartReminders: true }).lean();
  if (preferences.length === 0) return;

  const { subject, html } = buildVotingOpenEmail(electionId, title);
  for (const preference of preferences) {
    await enqueueNotification(
      { to: preference.email, subject, html },
      `voting-open:${electionId}:${preference.walletAddress}`,
    );
  }
}

/** Webhook counterpart to enqueueVotingOpenNotifications. */
export async function enqueueVotingOpenWebhooks(electionId: number, title: string): Promise<void> {
  const preferences = await WebhookPreferenceModel.find({ electionId, wantsStartReminders: true }).lean();
  if (preferences.length === 0) return;

  const payload = buildVotingOpenWebhookPayload(electionId, title);
  for (const preference of preferences) {
    await enqueueWebhook(
      { url: preference.url, secret: preference.secret, payload },
      `voting-open-webhook:${electionId}:${preference.walletAddress}`,
    );
  }
}