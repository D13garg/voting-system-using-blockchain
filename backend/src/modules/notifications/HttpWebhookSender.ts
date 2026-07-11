// Concrete IWebhookSender implementation: a signed HTTP POST via plain
// fetch() - same "fetch-only house style for thin external integrations"
// reasoning as ResendNotificationSender.ts and PinataIpfsClient.ts (see
// their own header comments), except here the "external integration" is
// whatever arbitrary URL the subscriber themselves provided, not a fixed
// vendor endpoint.
//
// SIGNING SCHEME (approved forked decision, gap #4): Stripe/GitHub-style
// timestamped HMAC, not a bare signature over the body alone - signing
// `${timestamp}.${body}` rather than just `body` means a receiver can
// also reject an old, replayed request by checking the timestamp itself
// (this class does not enforce a replay window - that's the receiver's
// own concern, same as any real webhook provider's docs would say).
//   X-Webhook-Timestamp: <ms since epoch, string>
//   X-Webhook-Signature: sha256=<hex HMAC-SHA256 of `${timestamp}.${body}`, using the subscription's own secret>
//
// KNOWN LIMITATION, not addressed by this gap: no SSRF hardening on the
// subscriber-supplied URL (e.g. rejecting internal/private IP ranges).
// notification.routes.ts's webhook-subscribe endpoint validates it's a
// well-formed URL (zod .url()) only, same validation depth as the email
// channel's .email(). Worth flagging for a future security-hardening
// pass if this ever accepts subscriptions from untrusted third parties
// at scale, but out of scope for what gap #4 was approved to build.
//
// KNOWN IN-SANDBOX LIMITATION: arbitrary subscriber-supplied webhook
// URLs are by definition not on this sandbox's network egress allowlist -
// same "can't verify a real call in-sandbox" situation as
// ResendNotificationSender.ts. Also, like ResendNotificationSender.ts,
// this concrete sender class has no dedicated unit test of its own
// (matching this codebase's existing convention: the dispatch path
// is verified via a fake IJobQueue test double up to the point of
// enqueueing - see webhook.test.ts - not by mocking fetch() to exercise
// this class directly). Real end-to-end delivery needs a machine with
// real network access and a real subscriber-controlled endpoint.

import { createHmac } from "node:crypto";
import { NotificationError } from "./errors.js";
import type { IWebhookSender, WebhookDispatchInput } from "./IWebhookSender.js";

export class HttpWebhookSender implements IWebhookSender {
  async send(input: WebhookDispatchInput): Promise<void> {
    const timestamp = Date.now();
    const body = JSON.stringify(input.payload);
    const signature = createHmac("sha256", input.secret).update(`${timestamp}.${body}`).digest("hex");

    let response: Response;
    try {
      response = await fetch(input.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Timestamp": String(timestamp),
          "X-Webhook-Signature": `sha256=${signature}`,
        },
        body,
      });
    } catch (cause) {
      throw new NotificationError(`Network error while contacting webhook URL ${input.url}.`, cause);
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "<unreadable response body>");
      throw new NotificationError(
        `Webhook endpoint ${input.url} returned ${response.status}: ${responseBody}`,
        undefined,
      );
    }
  }
}
