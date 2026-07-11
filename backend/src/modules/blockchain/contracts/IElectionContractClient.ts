// Election contract client interface.
//
// Per the Phase 3 design decision (Question 2, with your refinement):
// domain modules (Phase 5: Election, Voting, Admin) depend on this
// interface, never on ElectionContractClient directly. This serves two
// concrete purposes:
//
// 1. Testability - a test double implementing this interface can be
//    handed to a domain module's tests with no real chain, no Hardhat
//    node, no mocking library reaching into viem's internals. It just
//    implements these methods.
// 2. Future contract versioning (ADR-005 Section 6.1) - when a V2
//    Election contract is eventually deployed, a new
//    ElectionContractClientV2 class implementing this SAME interface can
//    be swapped in (selected per-election by the contract-version map
//    described in Section 6.1) without any domain module needing to
//    change, as long as V2's logical behavior matches this interface's
//    contract. If V2 introduces genuinely new capabilities, the interface
//    itself gains new methods at that point - this is the seam where that
//    change belongs, not scattered across every module that happens to
//    call Election.

export interface ElectionData {
  title: string;
  startTime: bigint;
  endTime: bigint;
  finalized: boolean;
  creator: `0x${string}`;
  candidateCount: bigint;
}

export interface CandidateData {
  name: string;
  metadataURI: string;
  voteCount: bigint;
}

/**
 * Result of a write call (a state-changing transaction). Per ADR-003, the
 * backend is never the one *initiating* a vote or registration on a
 * user's behalf - the write methods on this interface exist for the rare
 * backend-initiated writes ADR-004 anticipates (see Section 7.2's
 * "Transaction submission helpers... for the few cases where the backend
 * itself needs to submit a transaction"), not for the core voting flow,
 * which always goes wallet -> contract -> chain directly from the
 * frontend and never touches this interface at all.
 */
export interface TransactionResult {
  transactionHash: `0x${string}`;
  blockNumber: bigint;
}

export interface IElectionContractClient {
  /** Reads a single election's on-chain metadata. Throws BlockchainError(CONTRACT_REVERT, "ElectionDoesNotExist") if electionId doesn't exist. */
  getElection(electionId: bigint): Promise<ElectionData>;

  /** Reads a single candidate's on-chain data. Throws BlockchainError(CONTRACT_REVERT) if the election or candidate doesn't exist. */
  getCandidate(electionId: bigint, candidateId: bigint): Promise<CandidateData>;

  /** Whether `voter` has already cast a vote in `electionId`. */
  hasVoted(electionId: bigint, voter: `0x${string}`): Promise<boolean>;

  /** Total number of elections ever created. */
  electionCount(): Promise<bigint>;

  /** Whether the contract is currently paused (architecture Section 6: emergency pause). */
  isPaused(): Promise<boolean>;

  /**
   * Submits a finalizeElection() transaction. Rare backend-initiated write
   * (see TransactionResult's doc comment) - in the primary user journey
   * this is signed by an admin's own wallet directly from the frontend,
   * not called through this interface. Exists here for completeness and
   * for any future automation (e.g., a scheduled job that finalizes
   * elections automatically once endTime passes, if that's ever added as
   * a feature) that would need a backend-held signer to act.
   */
  finalizeElection(electionId: bigint): Promise<TransactionResult>;
}
