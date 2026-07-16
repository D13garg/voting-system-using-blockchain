// Shared between deploy.ts and verify.ts - both read/write the same
// shared/contract-addresses.json file and previously each defined their
// own copy of this interface. Consolidated here, along with a real
// runtime validator (rather than a bare type annotation on a JSON.parse()
// result, which compiles but provides no actual guarantee about the
// parsed data's shape).
//
// KEYED BY CHAIN ID, NOT NETWORK NAME: frontend/src/lib/contractAddresses.ts
// (the sole consumer of this file) has always looked entries up by
// `String(chainId)` - deploy.ts/verify.ts previously keyed by Hardhat's
// `network.name` instead ("localhost"/"sepolia"), which would never have
// matched a real frontend lookup. Fixed here by keying on chainId, same as
// the frontend always expected; `network` is kept as a field ON each entry
// (human-readable, e.g. for verify.ts's own log lines and for anyone
// reading the JSON file directly), not as the lookup key itself.
import * as fs from "fs";

export interface ContractAddresses {
  [chainId: string]: {
    network: string;
    chainId: number;
    voterRegistry: string;
    election: string;
    deployedAt: string;
    deployedBy: string;
  };
}

/**
 * Reads and validates shared/contract-addresses.json. Returns an empty
 * object if the file doesn't exist yet (the expected state before any
 * deployment has run) - this is a normal, valid case for deploy.ts's
 * "create or update" logic, not an error.
 */
export function readContractAddresses(filePath: string): ContractAddresses {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return assertIsContractAddresses(parsed, filePath);
}

function assertIsContractAddresses(value: unknown, sourcePath: string): ContractAddresses {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Malformed contract-addresses.json at ${sourcePath}: expected an object.`);
  }

  for (const [chainIdKey, entry] of Object.entries(value)) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).network !== "string" ||
      typeof (entry as Record<string, unknown>).chainId !== "number" ||
      typeof (entry as Record<string, unknown>).voterRegistry !== "string" ||
      typeof (entry as Record<string, unknown>).election !== "string"
    ) {
      throw new Error(
        `Malformed contract-addresses.json at ${sourcePath}: entry for chain "${chainIdKey}" is missing required fields (network, chainId, voterRegistry, election).`,
      );
    }
  }

  return value as ContractAddresses;
}