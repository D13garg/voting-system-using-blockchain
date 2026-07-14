// The write path for casting a vote. Per architecture Section 8/9 and
// voting.types.ts's own header comment ("vote() itself is wallet-direct
// ... IElectionContractClient has no write method for it by design"),
// this goes straight from the wallet to the contract — there is no
// backend endpoint to call for this at all, unlike every other hook in
// this directory.
//
// CONFIRMATION TIMING (approved decision, this slice's design doc):
// success is reported only after useWaitForTransactionReceipt resolves
// (the tx is actually mined and confirmed), not the moment the wallet
// returns a hash. This is the same rule the scaffold's design tokens
// already encode (emerald "confirmed" color reserved for genuinely
// on-chain-confirmed state) — showing "you voted" on a mere submitted
// hash would be the UI making a promise the chain hasn't kept yet.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import electionAbi from "../../../shared/abi/Election.json";
import { getContractAddresses } from "../lib/contractAddresses.js";

interface UseCastVoteResult {
  castVote: (candidateId: number) => void;
  status: "idle" | "signing" | "confirming" | "confirmed" | "error";
  error: string | null;
  txHash: `0x${string}` | undefined;
}

export function useCastVote(electionId: number | null | undefined, chainId: number): UseCastVoteResult {
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, status: writeStatus, error: writeError, reset } = useWriteContract();
  const {
    status: receiptStatus,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (receiptStatus === "success" && electionId !== null && electionId !== undefined) {
      // hasVoted is a live read (accurate immediately); results is the
      // indexed mirror (won't reflect this vote until the worker's next
      // poll) — invalidating both is correct even though only one will
      // actually change right away.
      void queryClient.invalidateQueries({ queryKey: ["has-voted", electionId] });
      void queryClient.invalidateQueries({ queryKey: ["election-results", electionId] });
    }
  }, [receiptStatus, electionId, queryClient]);

  function castVote(candidateId: number): void {
    if (electionId === null || electionId === undefined) return;
    reset();
    const { election } = getContractAddresses(chainId);
    writeContract({
      address: election,
      abi: electionAbi,
      functionName: "vote",
      args: [BigInt(electionId), BigInt(candidateId)],
    });
  }

  const status: UseCastVoteResult["status"] =
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

  return { castVote, status, error, txHash };
}
