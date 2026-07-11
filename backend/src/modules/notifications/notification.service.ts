// Notifications module service layer.

import { HttpError } from "../../shared/httpError.js";
import { IndexedElectionModel } from "../indexing/indexedElection.model.js";
import { enqueueNotification } from "./notification.queue.js";
import { NotificationPreferenceModel } from "./notificationPreference.model.js";

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

function buildElectionFinalizedEmail(electionId: number, title: string): { subject: string; html: string } {
  return {
    subject: `Election "${title}" results are final`,
    html: `<p>The election <strong>${title}</strong> (#${electionId}) has been finalized. Results are now available.</p>`,
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