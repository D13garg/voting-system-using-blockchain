// Wallet module service layer (architecture Section 7.1: "address
// validation, ENS resolution, wallet-centric helpers"). Internal-only in
// this pass (approved design fork - see HANDOFF.md / chat history): no
// routes yet, consumed directly by other modules (Admin's audit display,
// Notifications' personalization) that want a human-readable identity
// for a wallet address.
//
// ENS RESOLUTION IS NEVER LOAD-BEARING: every function here that touches
// the network degrades to `null` on any failure - missing RPC_URL_MAINNET_ENS,
// RPC timeout, malformed response, whatever - and never throws. A
// display enhancement failing must never break the request that asked
// for it (e.g. an audit log write must succeed with a raw address even if
// mainnet RPC is down). Contrast with toChecksumAddress below, which DOES
// throw - address format validity is a real correctness concern (a
// malformed address stored in Mongo is a data-integrity bug), not a
// display nicety.
//
// CACHING (approved design fork): a single-process in-memory TTL cache
// (wallet.cache.ts) - fine at this project's scale (Section 24's "does
// this provide genuine value" test), but means a horizontally-scaled
// deployment would have one cache per instance, not a shared one. Revisit
// with a Redis-backed cache if/when this module's traffic or deployment
// topology actually needs it - not a real cost today.

import { getAddress, isAddress } from "viem";
import { normalize } from "viem/ens";
import { HttpError } from "../../shared/httpError.js";
import { logger } from "../../shared/logger.js";
import { TtlCache } from "./wallet.cache.js";
import { getEnsPublicClient } from "./wallet.provider.js";
import type { IEnsClient } from "./wallet.types.js";

const ENS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour - ENS records change rarely.

const ensNameCache = new TtlCache<string | null>(ENS_CACHE_TTL_MS);
const ensAddressCache = new TtlCache<string | null>(ENS_CACHE_TTL_MS);

class ViemEnsClient implements IEnsClient {
  async getEnsName(checksummedAddress: string): Promise<string | null> {
    const client = getEnsPublicClient();
    if (!client) return null;
    const name = await client.getEnsName({ address: checksummedAddress as `0x${string}` });
    return name ?? null;
  }

  async getEnsAddress(name: string): Promise<string | null> {
    const client = getEnsPublicClient();
    if (!client) return null;
    const address = await client.getEnsAddress({ name: normalize(name) });
    return address ?? null;
  }
}

let ensClient: IEnsClient = new ViemEnsClient();

/**
 * Test-only seam, same pattern as the Blockchain module's
 * _setElectionContractClientForTests: lets tests inject a fake IEnsClient
 * instead of requiring real mainnet RPC access. Never called from
 * non-test code. Passing `undefined` restores the real viem-backed client.
 */
export function _setEnsClientForTests(client: IEnsClient | undefined): void {
  ensClient = client ?? new ViemEnsClient();
}

/** Test-only seam: clears both ENS caches between tests. */
export function _clearEnsCachesForTests(): void {
  ensNameCache._clearForTests();
  ensAddressCache._clearForTests();
}

/** Whether a string is a syntactically and checksum-consistent Ethereum address (EIP-55). */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Normalizes an address to its EIP-55 checksummed form. Throws
 * (HttpError 400) on an invalid address - unlike ENS resolution, address
 * format validity is authoritative input validation, not a display
 * nicety, so callers that need a guaranteed-valid address should let this
 * throw rather than silently continuing with malformed input.
 */
export function toChecksumAddress(address: string): string {
  if (!isAddress(address)) {
    throw new HttpError(400, "INVALID_ADDRESS", `"${address}" is not a valid Ethereum address.`);
  }
  return getAddress(address);
}

/**
 * Reverse ENS resolution: address -> primary name (e.g. "alice.eth"), or
 * `null` if the address has none set, the address is invalid, ENS isn't
 * configured (no RPC_URL_MAINNET_ENS), or resolution fails for any
 * reason. Never throws - see this file's header comment.
 */
export async function resolveEnsName(address: string): Promise<string | null> {
  if (!isValidAddress(address)) return null;
  const checksummed = getAddress(address);

  const cached = ensNameCache.get(checksummed);
  if (cached !== undefined) return cached;

  let name: string | null;
  try {
    name = await ensClient.getEnsName(checksummed);
  } catch (error) {
    // Guard lives HERE, not inside ViemEnsClient - the "never throws"
    // contract must hold for every IEnsClient implementation (including
    // test fakes and any future one), not just the real viem-backed one.
    logger.warn({ err: error, address: checksummed }, "ENS reverse resolution failed; degrading to null");
    name = null;
  }
  ensNameCache.set(checksummed, name);
  return name;
}

/**
 * Forward ENS resolution: name (e.g. "alice.eth") -> address, or `null`
 * if unregistered, unresolved, ENS isn't configured, or resolution fails
 * for any reason. Never throws - see this file's header comment.
 */
export async function resolveAddressFromEnsName(name: string): Promise<string | null> {
  const cacheKey = name.toLowerCase();
  const cached = ensAddressCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let address: string | null;
  try {
    address = await ensClient.getEnsAddress(name);
  } catch (error) {
    logger.warn({ err: error, name }, "ENS forward resolution failed; degrading to null");
    address = null;
  }
  ensAddressCache.set(cacheKey, address);
  return address;
}

/**
 * Convenience helper for display contexts (audit logs, notification
 * personalization): resolves the ENS name if one exists, otherwise falls
 * back to the checksummed address itself. Never throws for an
 * already-valid address; invalid input is returned unchanged so a caller
 * building a log line doesn't lose the original (malformed) value.
 */
export async function toDisplayName(address: string): Promise<string> {
  if (!isValidAddress(address)) return address;
  const checksummed = getAddress(address);
  const name = await resolveEnsName(checksummed);
  return name ?? checksummed;
}
