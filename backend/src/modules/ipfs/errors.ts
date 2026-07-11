// Error type for IPFS pinning-provider failures, same purpose and shape
// as blockchain/errors.ts's BlockchainError: gives every IIpfsClient
// implementation a single, consistent error to throw, so ipfs.service.ts
// has exactly one error type to catch and translate into an HttpError
// (502 - the provider is an external dependency, not a client mistake),
// instead of every implementation's own error shape (fetch's TypeError,
// a non-2xx response body, etc.) leaking up into the service layer.

export class IpfsError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "IpfsError";
    this.cause = cause;
  }
}