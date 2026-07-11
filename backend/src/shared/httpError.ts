// Reusable HTTP error type for domain-module route handlers (shared
// infrastructure - Section 7.1's distinction between domain modules and
// shared infrastructure like middleware/, config/, utils/).
//
// Without this, every domain module either invents its own ad-hoc error
// shape or every non-2xx response falls through errorHandler.ts's generic
// "anything that isn't a Mongoose ValidationError is a 500" branch - wrong
// for the common case of "the request itself was invalid" (401, 403, 404,
// 409, 422). This is intentionally introduced now, with the Auth module
// (Phase 5's first module), because it is exactly the kind of dependency
// every subsequent domain module will also need (invalid nonce, expired
// session, not authorized to approve a registration, etc.) - see
// HANDOFF.md's Phase 5 section for why this was added here rather than
// deferred.

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}