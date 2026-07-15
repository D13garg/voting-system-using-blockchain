// GET /elections, unfiltered — deliberately distinct from
// useElections.ts (Landing's hook), which filters out drafts by design
// (that's a separate, already-approved public-page decision, not
// something this hook should also do). Admin Dashboard needs to see
// drafts and under-populated elections to offer a "continue" link for
// the resumable Create Election wizard (2026-07-14 session, user's
// approved call to build resumability rather than single-sitting-only).
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";
import type { ElectionSummary } from "./useElections.js";

/**
 * Frontend-only UX guard, NOT an on-chain-enforced rule — the contract
 * itself has no minimum candidate count. Chosen so the wizard doesn't
 * consider a 0- or 1-candidate election "done"; a future admin-facing
 * setting could make this configurable, not built now since there's no
 * evidence yet it needs to be.
 */
export const MIN_CANDIDATES_FOR_COMPLETE = 2;

export function useAdminElections(
  enabled: boolean,
): ReturnType<typeof useQuery<ElectionSummary[], Error>> {
  return useQuery({
    queryKey: ["admin-elections"],
    queryFn: () => apiFetch<{ elections: ElectionSummary[] }>("/elections").then((r) => r.elections),
    enabled,
  });
}

/** An election is "in progress" if it isn't on-chain yet, or is but doesn't have enough candidates yet. */
export function isElectionInProgress(election: ElectionSummary): boolean {
  if (election.electionId === null) return true;
  return (election.candidateCount ?? 0) < MIN_CANDIDATES_FOR_COMPLETE;
}
