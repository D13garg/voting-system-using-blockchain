// GET /elections/:id — election.routes.ts's `:id` is the Mongo draft id,
// NOT the on-chain electionId (see useCandidates.ts / useElectionResults.ts
// / useHasVoted.ts, all of which take the numeric `electionId` field off
// the object this hook returns). This split is a real backend API
// inconsistency, not a frontend choice — see ElectionDetail.tsx's header
// comment for the full reasoning on why the route stays keyed on the
// Mongo id rather than "fixing" it frontend-side.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";
import type { ElectionSummary } from "./useElections.js";

export function useElection(id: string | undefined): ReturnType<typeof useQuery<ElectionSummary, Error>> {
  return useQuery({
    queryKey: ["election", id],
    queryFn: () => apiFetch<{ election: ElectionSummary }>(`/elections/${id}`).then((r) => r.election),
    enabled: id !== undefined,
  });
}
