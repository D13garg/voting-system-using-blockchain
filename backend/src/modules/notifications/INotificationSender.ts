// Notification sender interface. Same interface-first rationale as
// modules/ipfs/IIpfsClient.ts: testability (a fake implementation needs
// no real network call) and provider-swapping (ResendNotificationSender
// is the concrete default - see its own header comment for why Resend -
// but nothing outside this module depends on Resend specifically).

export interface NotificationInput {
  to: string;
  subject: string;
  html: string;
}

export interface INotificationSender {
  send(input: NotificationInput): Promise<void>;
}