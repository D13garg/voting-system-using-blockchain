// Dedicated mainnet-only viem client, used ONLY for ENS resolution.
//
// This is a deliberate exception to the Blockchain Service Layer being
// "the only module that imports ABIs / holds a provider/signer" (Section
// 7.2, folder structure comment) - that rule is about CONTRACT
// interaction (votes, registrations, elections), which must only ever
// happen against the configured Sepolia/Hardhat network (ADR-003:
// blockchain-source-of-truth). ENS resolution is not contract
// interaction in that sense - it's a public-good name-lookup that only
// exists on mainnet, orthogonal to which chain this app transacts on.
// Keeping it a plain read-only public client (no signer, no ABI, no
// transaction capability of any kind) with its own tiny module here
// keeps the Blockchain module's chokepoint claim intact for the thing it
// actually protects.
//
// Approved design fork (see chat/handoff): a dedicated mainnet client,
// not a reuse of getPublicClient() from the Blockchain module - Hardhat
// has no ENS contracts at all, and Sepolia's own ENS deployment is a
// sparse test registry, not where real names (`alice.eth`) live.

import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { env } from "../../config/env.js";

let cachedClient: PublicClient | undefined | null;

/**
 * Returns a shared, lazily-constructed read-only mainnet client, or
 * `null` if RPC_URL_MAINNET_ENS isn't configured. Returning `null`
 * instead of throwing is deliberate: ENS resolution is a display-only
 * enhancement (see env.ts's header comment on this variable), so an
 * operator who hasn't set up a mainnet RPC key should get "no ENS names
 * resolved" everywhere, not a startup failure or per-request error.
 */
export function getEnsPublicClient(): PublicClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  if (!env.RPC_URL_MAINNET_ENS) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createPublicClient({
    chain: mainnet,
    transport: http(env.RPC_URL_MAINNET_ENS),
  });

  return cachedClient;
}

/** Test-only escape hatch, same pattern as the Blockchain module's _resetPublicClientForTests. */
export function _resetEnsPublicClientForTests(): void {
  cachedClient = undefined;
}
