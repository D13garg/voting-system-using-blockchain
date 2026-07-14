// GET /elections/:electionId/results — reads from the indexed mirror
// (same poll-lag as Landing's list), so "results" here means "as of the
// worker's last poll," not real-time.
//
// SCOPE DECISION (this slice's design doc, user's call): only fetched
// once the election is voting_ended or result_finalized. This is a UX
// choice, not a security boundary — the endpoint itself is public and
// anyone could call it directly regardless — but not fetching it at all
// during active voting keeps the intent unambiguous in code (no tally
// value ever exists client-side to accidentally render early) and avoids
// a pointless request while it would be hidden anyway.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";
import type { ElectionLifecycleState } from "./useElections.js";

export interface CandidateResult {
  candidateId: number;
  name: string;
  metadataURI: string;
  voteCount: number;
}

export interface ElectionResults {
  electionId: number;
  totalVotes: number;
  candidates: CandidateResult[];
}

const RESULTS_VISIBLE_STATES: ElectionLifecycleState[] = ["voting_ended", "result_finalized"];

export function useElectionResults(
  electionId: number | null | undefined,
  state: ElectionLifecycleState | undefined,
): ReturnType<typeof useQuery<ElectionResults, Error>> {
  const visible = state !== undefined && RESULTS_VISIBLE_STATES.includes(state);
  return useQuery({
    queryKey: ["election-results", electionId],
    queryFn: () => apiFetch<{ results: ElectionResults }>(`/elections/${electionId}/results`).then((r) => r.results),
    enabled: visible && electionId !== null && electionId !== undefined,
  });
}
