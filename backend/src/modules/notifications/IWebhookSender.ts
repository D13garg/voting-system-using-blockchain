// Webhook sender interface. Deliberately separate from
// INotificationSender (email) rather than a shared "dispatch channel"
// abstraction - the two have genuinely different inputs (a signed HTTP
// POST vs. an email's to/subject/html) and forcing them into one shape
// would mean one side always carrying fields the other ignores. Same
// testability/provider-swapping rationale as INotificationSender.ts and
// modules/ipfs/IIpfsClient.ts otherwise.

export interface WebhookDispatchInput {
  url: string;
  /** Per-subscription HMAC-SHA256 signing secret - see WebhookPreferenceModel. */
  secret: string;
  payload: Record<string, unknown>;
}

export interface IWebhookSender {
  send(input: WebhookDispatchInput): Promise<void>;
}
