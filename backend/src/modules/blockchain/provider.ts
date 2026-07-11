// Provider construction (ADR-004: this module is the only place in the
// backend/worker codebase permitted to construct a viem client or hold a
// provider/signer).
//
// Per ADR-004's failover design: Alchemy is primary, Infura is fallback.
// viem's fallback() transport tries providers in order and only moves to
// the next one on failure, so under normal operation every request goes
// through Alchemy with zero overhead - Infura is purely a backstop.

import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { sepolia, hardhat } from "viem/chains";
import { env } from "../../config/env.js";

/**
 * Selects the correct viem chain definition based on the configured
 * CHAIN_ID. Per the architecture (Section 5: "Sepolia testnet only, no
 * mainnet deployment"), only two chains are ever expected in practice:
 * Sepolia (11155111) for testnet/production, and Hardhat's local network
 * (31337) for local development (Section 19). Any other chain ID is
 * treated as a misconfiguration and fails loudly at startup, consistent
 * with the centralized configuration layer's own fail-fast philosophy
 * (Section 18) - silently falling back to an unrecognized chain would let
 * a misconfigured RPC URL run against the wrong network undetected.
 */
function resolveChain(chainId: number): typeof sepolia | typeof hardhat {
  switch (chainId) {
    case sepolia.id:
      return sepolia;
    case hardhat.id:
      return hardhat;
    default:
      throw new Error(
        `Unsupported CHAIN_ID: ${chainId}. This project only supports Sepolia (${sepolia.id}) and the local Hardhat network (${hardhat.id}) - see architecture Section 5.`,
      );
  }
}

let cachedClient: PublicClient | undefined;

/**
 * Returns a shared, lazily-constructed viem PublicClient configured with
 * Alchemy-primary / Infura-fallback transport. Cached after first
 * construction - there is no reason for every call site in the blockchain
 * module to construct its own client, and a single shared client lets
 * viem's own internal request batching/caching work across the whole
 * process rather than being reset per call site.
 */
export function getPublicClient(): PublicClient {
  if (cachedClient) {
    return cachedClient;
  }

  const chain = resolveChain(env.CHAIN_ID);

  cachedClient = createPublicClient({
    chain,
    transport: fallback([http(env.RPC_URL_PRIMARY), http(env.RPC_URL_FALLBACK)]),
  });

  return cachedClient;
}

/**
 * Test-only escape hatch: clears the cached client so tests can construct
 * a fresh one against a different configuration (e.g., a local Hardhat
 * node's RPC URL) without restarting the process. Not used anywhere in
 * production code paths.
 */
export function _resetPublicClientForTests(): void {
  cachedClient = undefined;
}
