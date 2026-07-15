// Step 2 of the wizard: Election.createElection(title, startTime,
// endTime), wallet-direct (same pattern as useCastVote.ts/
// useConfirmRegistration.ts — no backend relay for on-chain writes
// anywhere in this app). The contract returns the new electionId as a
// function return value, but that's not observable from a transaction
// receipt on the frontend — only emitted event LOGS are. So this decodes
// the `ElectionCreated(electionId indexed, title, startTime, endTime,
// creator indexed)` event from the receipt's logs instead, same
// principle the worker's own eventSync.ts already relies on for reading
// chain state, just wallet-side instead of indexer-side.
import { useEffect, useState } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import electionAbi from "../../../shared/abi/Election.json";
import { getContractAddresses } from "../lib/contractAddresses.js";

interface UseCreateElectionOnChainResult {
  createElectionOnChain: (title: string, startTime: Date, endTime: Date) => void;
  status: "idle" | "signing" | "confirming" | "confirmed" | "error";
  error: string | null;
  electionId: number | null;
  transactionHash: `0x${string}` | undefined;
}

export function useCreateElectionOnChain(chainId: number): UseCreateElectionOnChainResult {
  const { writeContract, data: txHash, status: writeStatus, error: writeError, reset } = useWriteContract();
  const {
    status: receiptStatus,
    error: receiptError,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });
  const [electionId, setElectionId] = useState<number | null>(null);

  useEffect(() => {
    if (receiptStatus !== "success" || !receipt) return;
    const { election } = getContractAddresses(chainId);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== election.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: electionAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "ElectionCreated") {
          const args = decoded.args as unknown as { electionId: bigint };
          setElectionId(Number(args.electionId));
          return;
        }
      } catch {
        // Not every log on this receipt is necessarily this event (e.g.
        // it could theoretically share a block with unrelated logs) —
        // skip anything decodeEventLog can't match, same defensive
        // pattern eventSync.ts uses for the same reason.
      }
    }
  }, [receiptStatus, receipt, chainId]);

  function createElectionOnChain(title: string, startTime: Date, endTime: Date): void {
    reset();
    setElectionId(null);
    const { election } = getContractAddresses(chainId);
    writeContract({
      address: election,
      abi: electionAbi,
      functionName: "createElection",
      args: [title, BigInt(Math.floor(startTime.getTime() / 1000)), BigInt(Math.floor(endTime.getTime() / 1000))],
    });
  }

  const status: UseCreateElectionOnChainResult["status"] =
    receiptStatus === "success"
      ? "confirmed"
      : writeStatus === "error" || receiptStatus === "error"
        ? "error"
        : writeStatus === "pending"
          ? "signing"
          : writeStatus === "success"
            ? "confirming"
            : "idle";

  const error = writeError?.message ?? receiptError?.message ?? null;

  return { createElectionOnChain, status, error, electionId, transactionHash: txHash };
}
