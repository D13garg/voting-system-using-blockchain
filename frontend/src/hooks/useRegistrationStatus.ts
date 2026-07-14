// GET /voters/me/registration/:electionId + POST /voters/register-request
// (admin.routes.ts). The real gate for whether a wallet can vote is
// `onChainConfirmed`, NOT `status === "approved"` — an admin can approve
// a request in the review queue without having submitted (or without the
// worker having yet indexed) the actual on-chain registerVoter() tx, per
// admin.types.ts's own header comment on why these two fields are
// deliberately independent. RegistrationGate.tsx reads onChainConfirmed,
// not status, to decide whether to show a ballot.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";

export type RegistrationRequestStatus = "pending" | "approved" | "rejected" | "not_requested";

export interface RegistrationStatus {
  electionId: number;
  voterAddress: string;
  status: RegistrationRequestStatus;
  onChainConfirmed: boolean;
}

export function useRegistrationStatus(
  electionId: number | null | undefined,
  isAuthenticated: boolean,
): ReturnType<typeof useQuery<RegistrationStatus, Error>> {
  return useQuery({
    queryKey: ["registration-status", electionId],
    queryFn: () =>
      apiFetch<{ status: RegistrationStatus }>(`/voters/me/registration/${electionId}`).then((r) => r.status),
    enabled: isAuthenticated && electionId !== null && electionId !== undefined,
  });
}

export function useRequestRegistration(
  electionId: number | null | undefined,
): ReturnType<typeof useMutation<unknown, Error, void>> {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, void>({
    mutationFn: () => apiFetch("/voters/register-request", { method: "POST", body: { electionId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["registration-status", electionId] });
    },
  });
}
