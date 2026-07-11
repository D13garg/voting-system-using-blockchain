// Shared types for the Wallet module (architecture Section 7.1:
// "address validation, ENS resolution, wallet-centric helpers").

/**
 * Narrow seam over viem's ENS actions, same purpose and pattern as
 * IElectionContractClient in the Blockchain module: lets tests inject a
 * fake resolver instead of reaching into viem's internals or requiring
 * real mainnet RPC access. Deliberately minimal - only the two lookups
 * this module actually performs.
 */
export interface IEnsClient {
  /** Reverse resolution: address -> primary ENS name, or null if none is set. */
  getEnsName(checksummedAddress: string): Promise<string | null>;
  /** Forward resolution: ENS name -> address, or null if unregistered/unresolved. */
  getEnsAddress(name: string): Promise<string | null>;
}
