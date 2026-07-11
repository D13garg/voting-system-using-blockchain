// Concrete viem-backed implementation of IVoterRegistryContractClient.
// See ElectionContractClient.ts for the full rationale on both the
// error-handling centralization pattern and the readContract/writeContract
// (rather than getContract) viem usage - identical reasoning applies here.

import { readContract, writeContract, waitForTransactionReceipt } from "viem/actions";
import type { Abi, PublicClient } from "viem";
import voterRegistryAbiJson from "../../../../../shared/abi/VoterRegistry.json" with { type: "json" };
import { env } from "../../../config/env.js";
import { logger } from "../../../shared/logger.js";
import { normalizeError } from "../errors.js";
import { getPublicClient } from "../provider.js";
import { requireBackendWalletClient } from "../signer.js";
import type { IVoterRegistryContractClient, TransactionResult } from "./IVoterRegistryContractClient.js";

const blockchainLogger = logger.child({ module: "blockchain", contract: "VoterRegistry" });

const voterRegistryAbi = voterRegistryAbiJson as Abi;

export class VoterRegistryContractClient implements IVoterRegistryContractClient {
  constructor(
    private readonly address: `0x${string}` = env.CONTRACT_ADDRESS_VOTER_REGISTRY as `0x${string}`,
    private readonly publicClient: PublicClient = getPublicClient(),
  ) {}

  async isRegisteredForElection(electionId: bigint, voter: `0x${string}`): Promise<boolean> {
    try {
      const result = await readContract(this.publicClient, {
        address: this.address,
        abi: voterRegistryAbi,
        functionName: "isRegisteredForElection",
        args: [electionId, voter],
      });
      return result as boolean;
    } catch (error) {
      this.handleError(error, "isRegisteredForElection", { electionId, voter });
    }
  }

  async registerVoter(electionId: bigint, voter: `0x${string}`): Promise<TransactionResult> {
    try {
      const walletClient = requireBackendWalletClient();
      const hash = await writeContract(walletClient, {
        address: this.address,
        abi: voterRegistryAbi,
        functionName: "registerVoter",
        args: [electionId, voter],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      const receipt = await waitForTransactionReceipt(this.publicClient, { hash });
      return { transactionHash: hash, blockNumber: receipt.blockNumber };
    } catch (error) {
      this.handleError(error, "registerVoter", { electionId, voter });
    }
  }

  async removeVoter(electionId: bigint, voter: `0x${string}`): Promise<TransactionResult> {
    try {
      const walletClient = requireBackendWalletClient();
      const hash = await writeContract(walletClient, {
        address: this.address,
        abi: voterRegistryAbi,
        functionName: "removeVoter",
        args: [electionId, voter],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      const receipt = await waitForTransactionReceipt(this.publicClient, { hash });
      return { transactionHash: hash, blockNumber: receipt.blockNumber };
    } catch (error) {
      this.handleError(error, "removeVoter", { electionId, voter });
    }
  }

  private handleError(error: unknown, method: string, context: Record<string, unknown>): never {
    const normalized = normalizeError(error);
    blockchainLogger.error(
      { method, context, kind: normalized.kind, retryable: normalized.retryable },
      normalized.message,
    );
    throw normalized;
  }
}
