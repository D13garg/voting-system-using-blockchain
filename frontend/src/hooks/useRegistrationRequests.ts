// GET /admin/registration-requests + approve/reject mutations
// (admin.routes.ts). Note the endpoints' own doc comments: approve/reject
// record the off-chain REVIEW DECISION only — the admin's wallet still
// has to separately submit registerVoter() on-chain (see
// useConfirmRegistration.ts for that step, wired into
// RegistrationRequestRow.tsx as a distinct "Confirm on-chain" action, not
// folded into "Approve" itself, since they're genuinely two different
// actions with two different costs (one is free, one costs gas)).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";

export type RegistrationRequestStatus = "pending" | "approved" | "rejected";

export interface RegistrationRequestSummary {
  id: string;
  electionId: number;
  voterAddress: string;
  voterDisplayName: string;
  status: RegistrationRequestStatus;
  onChainConfirmed: boolean;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export function useRegistrationRequests(
  status: RegistrationRequestStatus | undefined,
  enabled: boolean,
): ReturnType<typeof useQuery<RegistrationRequestSummary[], Error>> {
  return useQuery({
    queryKey: ["registration-requests", status ?? "all"],
    queryFn: () =>
      apiFetch<{ requests: RegistrationRequestSummary[] }>(
        status ? `/admin/registration-requests?status=${status}` : "/admin/registration-requests",
      ).then((r) => r.requests),
    enabled,
  });
}

function useReviewMutation(decision: "approve" | "reject"): ReturnType<typeof useMutation<unknown, Error, string>> {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (requestId: string) =>
      apiFetch(`/admin/registration-requests/${requestId}/${decision}`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["registration-requests"] });
    },
  });
}

export function useApproveRequest(): ReturnType<typeof useMutation<unknown, Error, string>> {
  return useReviewMutation("approve");
}

export function useRejectRequest(): ReturnType<typeof useMutation<unknown, Error, string>> {
  return useReviewMutation("reject");
}
