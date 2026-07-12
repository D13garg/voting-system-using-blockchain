// VoterRegistry contract client interface. See IElectionContractClient.ts
// for the full rationale (testability + future versioning) - the same
// reasoning applies identically here.

import type { TransactionResult } from "./IElectionContractClient.js";
export type { TransactionResult } from "./IElectionContractClient.js";

export interface IVoterRegistryContractClient {
  /** Whether `voter` is currently eligible to vote in `electionId` (per-election eligibility, per the confirmed design decision). */
  isRegisteredForElection(electionId: bigint, voter: `0x${string}`): Promise<boolean>;

  /**
   * Submits a registerVoter() transaction. As with
   * IElectionContractClient's write methods, this is the rare
   * backend-initiated path - the primary registration-approval flow
   * (architecture Section 14, step 4) has the admin's own wallet sign this
   * transaction directly from the frontend. This method exists for
   * automation/scripting use cases, not the core user journey.
   */
  registerVoter(electionId: bigint, voter: `0x${string}`): Promise<TransactionResult>;

  /** Submits a removeVoter() transaction. Same rare-backend-initiated-write caveat as registerVoter above. */
  removeVoter(electionId: bigint, voter: `0x${string}`): Promise<TransactionResult>;

  /**
   * Whether `account` currently holds `role` on THIS contract's own
   * AccessControl state. See IElectionContractClient.hasRole's doc
   * comment for the per-contract role-storage caveat - identical
   * reasoning applies here.
   */
  hasRole(role: `0x${string}`, account: `0x${string}`): Promise<boolean>;
}