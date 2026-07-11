// Public surface of the Blockchain Service Layer (ADR-004).
//
// Every other backend/worker module imports ONLY from this file, never
// directly from provider.ts, signer.ts, contracts/ElectionContractClient.ts,
// etc. This is what makes ADR-004's "single chokepoint" claim enforceable
// in practice rather than just asserted in documentation - there is
// exactly one import path into this module's internals, and it's this
// file.

export type {
  CandidateData,
  ElectionData,
  IElectionContractClient,
  TransactionResult,
} from "./contracts/IElectionContractClient.js";
export type { IVoterRegistryContractClient } from "./contracts/IVoterRegistryContractClient.js";

export { ElectionContractClient } from "./contracts/ElectionContractClient.js";
export { VoterRegistryContractClient } from "./contracts/VoterRegistryContractClient.js";

export { BlockchainError, normalizeError } from "./errors.js";
export type { BlockchainErrorKind } from "./errors.js";

export { getPublicClient, _resetPublicClientForTests } from "./provider.js";
export {
  getBackendWalletClient,
  requireBackendWalletClient,
  _resetBackendWalletClientForTests,
} from "./signer.js";

export { getNewLogs, RECOMMENDED_POLL_INTERVAL_MS } from "./events.js";
export type { LogSyncCheckpoint, LogSyncResult } from "./events.js";

export { estimateVoteGas, estimateRegisterVoterGas } from "./gas.js";

/**
 * Default, ready-to-use singleton instances for the common case (Phase 5
 * domain modules that just need "the" Election/VoterRegistry client
 * against this deployment's configured contract addresses, with no need
 * to construct a custom client pointed at a different address/version).
 * Constructed lazily so importing this file doesn't immediately require
 * env vars to be valid - only actually calling a method on these does.
 */
import { ElectionContractClient } from "./contracts/ElectionContractClient.js";
import { VoterRegistryContractClient } from "./contracts/VoterRegistryContractClient.js";
import type { IElectionContractClient } from "./contracts/IElectionContractClient.js";
import type { IVoterRegistryContractClient } from "./contracts/IVoterRegistryContractClient.js";

let defaultElectionClient: IElectionContractClient | undefined;
let defaultVoterRegistryClient: IVoterRegistryContractClient | undefined;

export function getElectionContractClient(): IElectionContractClient {
  defaultElectionClient ??= new ElectionContractClient();
  return defaultElectionClient;
}

export function getVoterRegistryContractClient(): IVoterRegistryContractClient {
  defaultVoterRegistryClient ??= new VoterRegistryContractClient();
  return defaultVoterRegistryClient;
}

/**
 * Test-only seam, same purpose and pattern as
 * _resetPublicClientForTests/_resetBackendWalletClientForTests: lets a
 * domain module's tests (e.g. the Election module) inject a fake
 * IElectionContractClient test double - no real chain, no Hardhat node,
 * no mocking library reaching into viem's internals - satisfying exactly
 * the testability purpose IElectionContractClient's own header comment
 * describes. Never called from non-test code.
 */
export function _setElectionContractClientForTests(client: IElectionContractClient | undefined): void {
  defaultElectionClient = client;
}

/** Same seam as _setElectionContractClientForTests, for the Admin module's tests. */
export function _setVoterRegistryContractClientForTests(client: IVoterRegistryContractClient | undefined): void {
  defaultVoterRegistryClient = client;
}