// Shared types for the Auth module (SIWE-based wallet authentication,
// architecture Section 7.1/7.3).

export interface AuthenticatedUser {
  /** EIP-55 checksummed address, as returned by siwe's SiweMessage parsing. */
  address: string;
  sessionId: string;
}

// Module augmentation, same intent as middleware/requestLogger.ts's
// res.locals.correlationId - keeps the authenticated user attached to the
// request without every downstream handler needing to know HOW it got
// there (cookie -> hash -> DB lookup, all internal to auth.middleware.ts).
//
// IMPORTANT: this must augment the GLOBAL `Express.Locals` namespace
// interface (see @types/express-serve-static-core's own
// `declare global { namespace Express { interface Locals {} } }`), not
// express's own re-exported `Locals` type - those are two different
// interfaces that happen to share a name. `res.locals`'s actual type
// resolves through the global one. Augmenting the wrong one silently
// typechecks (no tsc error) but leaves `res.locals` effectively `any` -
// caught here by eslint's type-aware `no-unsafe-*` rules flagging real
// usage in auth.routes.ts, not by tsc. See HANDOFF.md's Phase 5 section:
// requestLogger.ts had this exact same bug already, dormant since Phase 1
// because it only ever WRITES to res.locals.correlationId (assigning a
// value to an `any`-typed property isn't flagged), never reads it back
// through a type-checked call site.
declare global {
  // Augmenting an existing ambient global namespace (@types/express-serve-static-core's `Express`
  // namespace) - there is no ES2015-module equivalent for this; `namespace` is the only mechanism
  // TypeScript provides for it.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      auth?: AuthenticatedUser;
    }
  }
}