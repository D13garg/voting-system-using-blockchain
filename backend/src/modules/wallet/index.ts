// Public surface of the Wallet module (architecture Section 7.1:
// "address validation, ENS resolution, wallet-centric helpers").
//
// Same "one import path in" convention as the Blockchain module's
// index.ts: other modules (Admin, Notifications) import ONLY from here,
// never directly from wallet.service.ts/wallet.provider.ts/wallet.cache.ts.
//
// Internal-only in this pass (approved design fork - see HANDOFF.md):
// no wallet.routes.ts, no wiring into app.ts. Architecture Section 7.3's
// endpoint list doesn't call for a public HTTP endpoint, and adding one
// unguarded ahead of rate limiting (gap #3, not yet built) would be a new
// abuse surface for no approved use case yet.

export type { IEnsClient } from "./wallet.types.js";

export {
  isValidAddress,
  toChecksumAddress,
  resolveEnsName,
  resolveAddressFromEnsName,
  toDisplayName,
  _setEnsClientForTests,
  _clearEnsCachesForTests,
} from "./wallet.service.js";

export { getEnsPublicClient, _resetEnsPublicClientForTests } from "./wallet.provider.js";
