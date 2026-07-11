// A real, shippable INotificationSender that logs instead of sending -
// useful for local development or a demo deployment with no Resend
// account configured, without needing a fake/test double. Never throws
// NotificationError; logging is not expected to fail the way a real
// network call can.

import { logger } from "../../shared/logger.js";
import type { INotificationSender, NotificationInput } from "./INotificationSender.js";

const notificationLogger = logger.child({ service: "notifications", sender: "console" });

export class ConsoleNotificationSender implements INotificationSender {
  async send(input: NotificationInput): Promise<void> {
    notificationLogger.info(
      { to: input.to, subject: input.subject },
      "Notification (console sender - no real provider configured)",
    );
    await Promise.resolve();
  }
}