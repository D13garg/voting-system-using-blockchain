// Shared between deploy.ts and verify.ts - both read/write the same
// shared/contract-addresses.json file and previously each defined their
// own copy of this interface. Consolidated here, along with a real
// runtime validator (rather than a bare type annotation on a JSON.parse()
// result, which compiles but provides no actual guarantee about the
// parsed data's shape).
import * as fs from "fs";

export interface ContractAddresses {
  [networkName: string]: {
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

  for (const [networkName, entry] of Object.entries(value)) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).chainId !== "number" ||
      typeof (entry as Record<string, unknown>).voterRegistry !== "string" ||
      typeof (entry as Record<string, unknown>).election !== "string"
    ) {
      throw new Error(
        `Malformed contract-addresses.json at ${sourcePath}: entry for network "${networkName}" is missing required fields (chainId, voterRegistry, election).`,
      );
    }
  }

  return value as ContractAddresses;
}
