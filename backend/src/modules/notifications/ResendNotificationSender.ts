// Concrete INotificationSender implementation targeting Resend's REST
// API. Chosen (approved design decision) after the user pointed to their
// own prior project's use of Resend for transactional email: single npm
// API-key-based auth, one HTTP call per send, no SMTP config and no
// heavy vendor SDK required - the same "lean external integration"
// reasoning that got Pinata chosen over web3.storage for the IPFS
// module. Implemented via plain fetch() rather than the `resend` npm
// package for that same reason: Resend's send endpoint is a single,
// simple POST, and this codebase's other external integrations
// (PinataIpfsClient) already establish fetch-only as the house style for
// integrations this thin.
//
// KNOWN IN-SANDBOX LIMITATION (same discipline as PinataIpfsClient.ts's
// own header comment): api.resend.com is not in this sandbox's network
// egress allowlist, so a real call through this class cannot be
// verified here - only via a fake INotificationSender test double (see
// notification.test.ts). Real end-to-end email delivery needs to happen
// on a machine with real network access and a real RESEND_API_KEY.

import { env } from "../../config/env.js";
import { NotificationError } from "./errors.js";
import type { INotificationSender, NotificationInput } from "./INotificationSender.js";

const RESEND_SEND_URL = "https://api.resend.com/emails";

export class ResendNotificationSender implements INotificationSender {
  async send(input: NotificationInput): Promise<void> {
    let response: Response;
    try {
      response = await fetch(RESEND_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.NOTIFICATION_FROM_EMAIL,
          to: input.to,
          subject: input.subject,
          html: input.html,
        }),
      });
    } catch (cause) {
      throw new NotificationError("Network error while contacting Resend.", cause);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable response body>");
      throw new NotificationError(`Resend returned ${response.status}: ${body}`, undefined);
    }
  }
}