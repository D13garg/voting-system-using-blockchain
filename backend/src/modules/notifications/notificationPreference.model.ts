// NotificationPreference storage. Not explicitly schema'd anywhere in
// the architecture doc (Section 10 only lists AnalyticsRollup as a
// formally specified document model), but its existence is directly
// implied by Section 8's own tech-stack table entry for "Notification
// preferences" - "Yes - authoritative" under MongoDB. This collection is
// that authoritative store.
//
// SCOPE THIS SOLVES: this codebase is wallet-only identity (SIWE) - no
// email address exists anywhere else in the system. Without a real place
// to collect one, "email notification on election lifecycle events"
// (Section 8) would have no real recipient to send to. A voter opts in
// per-election via notification.routes.ts's subscribe endpoint, giving
// their own wallet address (from their authenticated session, never
// client-supplied - same "own address only" pattern as Voting's
// has-voted check) plus an email they choose to provide.
//
// SCOPE NOT SOLVED HERE (originally): only the ElectionFinalized
// lifecycle event was wired to actually dispatch (see eventSync.ts and
// notification.service.ts's dispatchElectionFinalizedNotifications) -
// the one lifecycle event Section 8's state-machine table explicitly
// names ("Worker locks the AnalyticsRollup as final; triggers
// notifications"). Election-start reminders were flagged here as a real
// future need requiring a scheduled/cron-style trigger nothing in this
// codebase had yet.
//
// GAP #7 (now built): wantsStartReminders below is that opt-in, added as
// a field on this SAME document rather than a new model - approved
// forked decision, distinct from gap #4's webhook-preference split.
// Unlike gap #4 (a different delivery MECHANISM entirely - HTTP POST vs.
// email, needing its own secret/signing concerns a shared document would
// leak into the wrong code paths), this is the same delivery mechanism
// and the same recipient identity, just an additional lifecycle EVENT
// TYPE a subscriber can ask to also receive. A dedicated opt-in endpoint
// (POST .../notifications/start-reminder-subscribe) sets this flag on an
// ALREADY-EXISTING row - it does not create one on its own, since "start
// reminders" without at least one delivery channel (email or webhook)
// already registered would have nowhere to go. See
// notification.service.ts's subscribeToElectionStartReminders and
// electionStartScan.worker.ts for the scheduled scan that reads this
// flag.

import mongoose, { Schema } from "mongoose";

export interface NotificationPreferenceDocument extends mongoose.Document {
  electionId: number;
  /** Always lowercased - same case-sensitivity convention as IndexedVoterRegistration's voterAddress. */
  walletAddress: string;
  email: string;
  /** Gap #7 opt-in flag - see this file's header comment. Default false: existing rows from before gap #7 must not start receiving a notification type they never asked for. */
  wantsStartReminders: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationPreferenceSchema = new Schema<NotificationPreferenceDocument>(
  {
    electionId: { type: Number, required: true },
    walletAddress: { type: String, required: true },
    email: { type: String, required: true },
    wantsStartReminders: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

notificationPreferenceSchema.index({ electionId: 1, walletAddress: 1 }, { unique: true });

export const NotificationPreferenceModel = mongoose.model<NotificationPreferenceDocument>(
  "NotificationPreference",
  notificationPreferenceSchema,
);