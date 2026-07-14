// GET /elections/:electionId/has-voted — requires an authenticated SIWE
// session (auth.middleware.ts's requireAuth). Unlike results, this is a
// LIVE contract read (voting.service.ts's hasVoted()), not the indexed
// mirror — accurate the moment a vote transaction confirms, which is why
// useCastVote.ts invalidates this query (not just results) right after
// its own on-chain wait resolves.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";

export interface VoteStatus {
  electionId: number;
  address: string;
  hasVoted: boolean;
}

export function useHasVoted(
  electionId: number | null | undefined,
  isAuthenticated: boolean,
): ReturnType<typeof useQuery<VoteStatus, Error>> {
  return useQuery({
    queryKey: ["has-voted", electionId],
    queryFn: () => apiFetch<{ status: VoteStatus }>(`/elections/${electionId}/has-voted`).then((r) => r.status),
    enabled: isAuthenticated && electionId !== null && electionId !== undefined,
  });
}
