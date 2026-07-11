// WebhookPreference storage - deliberately a SEPARATE collection/model
// from NotificationPreferenceModel (email), not a shared row with an
// optional webhookUrl column (approved forked decision, gap #4). Reasons:
//   1. A webhook subscription carries a secret that must never be
//      returned to the caller again after the initial subscribe response
//      (see webhook-subscribe route) - mixing that into the same document
//      as a plain email address would make "don't leak the secret"
//      something every future reader of NotificationPreference reads/
//      writes has to remember, rather than being structurally impossible
//      for the email-only path.
//   2. The two channels fail independently in practice (a dead inbox vs.
//      an unreachable webhook endpoint) and this project's established
//      pattern for "independent failure domains" is independent
//      collections/queues/workers (see notification.queue.ts vs.
//      webhook.queue.ts, and analytics' own separate queue).
//
// Same "wallet-only identity, opt in per-election" scope as
// NotificationPreferenceModel - see that file's header comment for the
// full rationale, which applies identically here.

import mongoose, { Schema } from "mongoose";

export interface WebhookPreferenceDocument extends mongoose.Document {
  electionId: number;
  /** Always lowercased - same convention as NotificationPreferenceModel/IndexedVoterRegistration. */
  walletAddress: string;
  url: string;
  /**
   * HMAC-SHA256 signing secret, generated server-side at subscribe time
   * (approved forked decision) - never client-supplied. Returned to the
   * caller exactly once, in the webhook-subscribe response body; this
   * document is the only durable copy. Re-subscribing (same election +
   * wallet) rotates this to a fresh value - see
   * notification.service.ts's subscribeToElectionWebhook.
   */
  secret: string;
  /**
   * Gap #7 opt-in flag, same field/meaning as
   * NotificationPreferenceModel's own wantsStartReminders - see that
   * file's header comment. Deliberately NOT touched by webhook secret
   * rotation - toggling this via start-reminder-subscribe must never
   * silently rotate a subscriber's already-configured signing secret.
   */
  wantsStartReminders: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const webhookPreferenceSchema = new Schema<WebhookPreferenceDocument>(
  {
    electionId: { type: Number, required: true },
    walletAddress: { type: String, required: true },
    url: { type: String, required: true },
    secret: { type: String, required: true },
    wantsStartReminders: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

webhookPreferenceSchema.index({ electionId: 1, walletAddress: 1 }, { unique: true });

export const WebhookPreferenceModel = mongoose.model<WebhookPreferenceDocument>(
  "WebhookPreference",
  webhookPreferenceSchema,
);