// Reads shared/contract-addresses.json (approved decision, Phase 4 design
// doc: a single file at repo root, read by both frontend and — as a
// follow-on, not yet wired — contracts/scripts, rather than duplicating
// addresses into frontend-only .env vars). Same relative-reach-outside-
// package pattern the backend already uses for shared/abi/*.json (see
// backend/src/modules/blockchain/contracts/ElectionContractClient.ts) —
// Vite's default dev-server fs.allow covers the whole pnpm workspace root,
// so this resolves the same way in dev and in `vite build`.
import addressesJson from "../../../shared/contract-addresses.json";
import { isAddress, type Address } from "viem";

interface ChainContractAddresses {
  network: string;
  voterRegistry: Address;
  election: Address;
}

const raw = addressesJson as Record<string, { network: string; voterRegistry: string; election: string }>;

/**
 * Returns the VoterRegistry/Election addresses for a given chain ID.
 * Throws if the chain isn't configured or an address is malformed — same
 * "fail loudly at startup, not silently at call time" principle as
 * env.ts's zod validation backend-side.
 */
export function getContractAddresses(chainId: number): ChainContractAddresses {
  const entry = raw[String(chainId)];
  if (!entry) {
    throw new Error(
      `No contract addresses configured for chain ${chainId} in shared/contract-addresses.json`,
    );
  }
  if (!isAddress(entry.voterRegistry) || !isAddress(entry.election)) {
    throw new Error(
      `Malformed contract address for chain ${chainId} in shared/contract-addresses.json`,
    );
  }
  return {
    network: entry.network,
    voterRegistry: entry.voterRegistry,
    election: entry.election,
  };
}

/** Whether real (non-placeholder) addresses exist yet for a given chain. */
export function hasDeployedContracts(chainId: number): boolean {
  const ZERO = "0x0000000000000000000000000000000000000000";
  try {
    const { voterRegistry, election } = getContractAddresses(chainId);
    return voterRegistry !== ZERO && election !== ZERO;
  } catch {
    return false;
  }
}
