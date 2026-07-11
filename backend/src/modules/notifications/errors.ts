// Error type for notification-provider failures, same role as
// modules/ipfs/errors.ts's IpfsError: every INotificationSender
// implementation throws exactly this, so callers (notification.worker.ts)
// have one error type to catch, rather than each provider's own error
// shape leaking up (a non-2xx Resend response, a console-sender-that-
// never-fails case, etc).

export class NotificationError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "NotificationError";
    this.cause = cause;
  }
}