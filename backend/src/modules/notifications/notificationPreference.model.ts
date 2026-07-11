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
// SCOPE NOT SOLVED HERE: only the ElectionFinalized lifecycle event is
// wired to actually dispatch (see eventSync.ts and
// notification.service.ts's dispatchElectionFinalizedNotifications) -
// the one lifecycle event Section 8's state-machine table explicitly
// names ("Worker locks the AnalyticsRollup as final; triggers
// notifications"). Election-start reminders are a real future need but
// would require a scheduled/cron-style trigger (nothing here currently
// runs on a wall-clock schedule, only in reaction to chain events) -
// deliberately left as a flagged, not-yet-built follow-up, not silently
// assumed to be covered by this collection's existence.

import mongoose, { Schema } from "mongoose";

export interface NotificationPreferenceDocument extends mongoose.Document {
  electionId: number;
  /** Always lowercased - same case-sensitivity convention as IndexedVoterRegistration's voterAddress. */
  walletAddress: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

const notificationPreferenceSchema = new Schema<NotificationPreferenceDocument>(
  {
    electionId: { type: Number, required: true },
    walletAddress: { type: String, required: true },
    email: { type: String, required: true },
  },
  { timestamps: true },
);

notificationPreferenceSchema.index({ electionId: 1, walletAddress: 1 }, { unique: true });

export const NotificationPreferenceModel = mongoose.model<NotificationPreferenceDocument>(
  "NotificationPreference",
  notificationPreferenceSchema,
);