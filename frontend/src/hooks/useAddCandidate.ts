// Step 4 of the wizard: Election.addCandidate(electionId, name,
// metadataURI), wallet-direct. Decodes `CandidateAdded(electionId
// indexed, candidateId indexed, name, metadataURI)` from the receipt —
// same reasoning as useCreateElectionOnChain.ts's identical pattern for
// ElectionCreated, see that file's header comment.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import electionAbi from "../../../shared/abi/Election.json";
import { getContractAddresses } from "../lib/contractAddresses.js";

interface UseAddCandidateResult {
  addCandidate: (electionId: number, name: string, metadataURI: string) => void;
  status: "idle" | "signing" | "confirming" | "confirmed" | "error";
  error: string | null;
  candidateId: number | null;
}

export function useAddCandidate(chainId: number): UseAddCandidateResult {
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, status: writeStatus, error: writeError, reset } = useWriteContract();
  const {
    status: receiptStatus,
    error: receiptError,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [pendingElectionId, setPendingElectionId] = useState<number | null>(null);

  useEffect(() => {
    if (receiptStatus !== "success" || !receipt) return;
    const { election } = getContractAddresses(chainId);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== election.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: electionAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "CandidateAdded") {
          const args = decoded.args as unknown as { candidateId: bigint };
          setCandidateId(Number(args.candidateId));
          if (pendingElectionId !== null) {
            void queryClient.invalidateQueries({ queryKey: ["candidates", pendingElectionId] });
          }
          return;
        }
      } catch {
        // See useCreateElectionOnChain.ts's identical comment.
      }
    }
  }, [receiptStatus, receipt, chainId, pendingElectionId, queryClient]);

  function addCandidate(electionId: number, name: string, metadataURI: string): void {
    reset();
    setCandidateId(null);
    setPendingElectionId(electionId);
    const { election } = getContractAddresses(chainId);
    writeContract({
      address: election,
      abi: electionAbi,
      functionName: "addCandidate",
      args: [BigInt(electionId), name, metadataURI],
    });
  }

  const status: UseAddCandidateResult["status"] =
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

  return { addCandidate, status, error, candidateId };
}
