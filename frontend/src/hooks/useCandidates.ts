// GET /elections/:electionId/candidates — keyed by the on-chain numeric
// electionId (candidate.routes.ts), not the Mongo draft id. See
// useElection.ts's header comment for the full ID-space explanation.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";

export interface CandidateSummary {
  candidateId: number;
  name: string;
  metadataURI: string;
  bio: string | null;
  imageUrl: string | null;
}

export function useCandidates(
  electionId: number | null | undefined,
): ReturnType<typeof useQuery<CandidateSummary[], Error>> {
  return useQuery({
    queryKey: ["candidates", electionId],
    queryFn: () =>
      apiFetch<{ candidates: CandidateSummary[] }>(`/elections/${electionId}/candidates`).then(
        (r) => r.candidates,
      ),
    enabled: electionId !== null && electionId !== undefined,
  });
}
