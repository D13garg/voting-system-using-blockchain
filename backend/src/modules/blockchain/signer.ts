// Backend signer management (ADR-004: "a dedicated low-privilege key,
// never the same key as any admin or deployer key").
//
// This signer is used ONLY for the rare backend-initiated writes
// anticipated by IElectionContractClient/IVoterRegistryContractClient's
// write methods (e.g., future automation). It is explicitly NOT used in
// the core voting/registration flow, which always goes wallet -> contract
// -> chain directly from the user's or admin's own browser wallet
// (ADR-003). If this signer is never actually used to submit a
// transaction in the deployed system, that is the expected, correct
// outcome for v1 - its existence is forward-looking infrastructure, not
// evidence that the backend is meant to act as a silent transaction
// submitter on anyone's behalf.

import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, hardhat } from "viem/chains";
import { env } from "../../config/env.js";

let cachedWalletClient: WalletClient | undefined;

/**
 * Returns the backend's signer-backed wallet client, or undefined if
 * BACKEND_SIGNER_PRIVATE_KEY is not configured. The env schema
 * (config/env.ts) deliberately makes this variable optional - a backend
 * deployment that never needs to submit transactions (the default case
 * for v1, per this file's header comment) shouldn't be forced to
 * provision a funded signer key it will never use.
 */
export function getBackendWalletClient(): WalletClient | undefined {
  if (!env.BACKEND_SIGNER_PRIVATE_KEY) {
    return undefined;
  }

  if (cachedWalletClient) {
    return cachedWalletClient;
  }

  // env.ts's zod schema validates BACKEND_SIGNER_PRIVATE_KEY against
  // /^0x[a-fA-F0-9]{64}$/ at startup (config/env.ts) - the runtime value
  // is guaranteed to match viem's `0x${string}` shape, but zod's .regex()
  // validates the pattern without narrowing the TypeScript type, so an
  // explicit cast here is correct, not a way of bypassing a check that
  // hasn't actually happened.
  const account = privateKeyToAccount(env.BACKEND_SIGNER_PRIVATE_KEY as `0x${string}`);
  const chain = env.CHAIN_ID === sepolia.id ? sepolia : hardhat;

  cachedWalletClient = createWalletClient({
    account,
    chain,
    transport: http(env.RPC_URL_PRIMARY),
  });

  return cachedWalletClient;
}

/**
 * Throws a clear, actionable error if a write method is called without a
 * configured signer, rather than letting the call fail deep inside viem
 * with a confusing "account is undefined" error. Call sites that need the
 * signer should use this instead of getBackendWalletClient() directly
 * when a missing signer should be treated as a hard failure.
 */
export function requireBackendWalletClient(): WalletClient {
  const client = getBackendWalletClient();
  if (!client) {
    throw new Error(
      "BACKEND_SIGNER_PRIVATE_KEY is not configured. This backend deployment cannot submit transactions. " +
        "See backend/.env.example and ADR-004 for why this key is optional and low-privilege by design.",
    );
  }
  return client;
}

export function _resetBackendWalletClientForTests(): void {
  cachedWalletClient = undefined;
}
