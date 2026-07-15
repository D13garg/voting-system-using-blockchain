// The on-chain half of approving a voter: VoterRegistry.registerVoter(
// electionId, voter). Wallet-direct, same pattern as useCastVote.ts
// (write -> wait for receipt -> report success only once genuinely
// confirmed, not on tx-hash-returned — consistent with the "confirmed"
// design token meaning on-chain-confirmed everywhere else in this app).
// Deliberately separate from useApproveRequest (useRegistrationRequests.ts)
// — approving is a free, off-chain review decision; this is a real
// transaction the admin's own wallet pays gas for. Folding them into one
// button would hide that distinction from the person clicking it.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import voterRegistryAbi from "../../../shared/abi/VoterRegistry.json";
import { getContractAddresses } from "../lib/contractAddresses.js";

interface UseConfirmRegistrationResult {
  confirmOnChain: () => void;
  status: "idle" | "signing" | "confirming" | "confirmed" | "error";
  error: string | null;
}

export function useConfirmRegistration(
  electionId: number,
  voterAddress: string,
  chainId: number,
): UseConfirmRegistrationResult {
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, status: writeStatus, error: writeError, reset } = useWriteContract();
  const { status: receiptStatus, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (receiptStatus === "success") {
      void queryClient.invalidateQueries({ queryKey: ["registration-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["registration-status", electionId] });
      void queryClient.invalidateQueries({ queryKey: ["my-elections"] });
    }
  }, [receiptStatus, electionId, queryClient]);

  function confirmOnChain(): void {
    reset();
    const { voterRegistry } = getContractAddresses(chainId);
    writeContract({
      address: voterRegistry,
      abi: voterRegistryAbi,
      functionName: "registerVoter",
      args: [BigInt(electionId), voterAddress as `0x${string}`],
    });
  }

  const status: UseConfirmRegistrationResult["status"] =
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

  return { confirmOnChain, status, error };
}
