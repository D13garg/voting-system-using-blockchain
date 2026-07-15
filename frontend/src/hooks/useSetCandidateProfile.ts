// PUT /elections/:id/candidates/:candidateId/profile (candidate.routes.ts).
// Bio is off-chain-only (not part of the on-chain Candidate struct), set
// as a separate step after addCandidate() confirms and candidateId is
// known.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";

interface SetProfileInput {
  electionId: number;
  candidateId: number;
  bio: string;
}

export function useSetCandidateProfile(): ReturnType<typeof useMutation<unknown, Error, SetProfileInput>> {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, SetProfileInput>({
    mutationFn: ({ electionId, candidateId, bio }) =>
      apiFetch(`/elections/${electionId}/candidates/${candidateId}/profile`, {
        method: "PUT",
        body: { bio },
      }),
    onSuccess: (_data, { electionId }) => {
      void queryClient.invalidateQueries({ queryKey: ["candidates", electionId] });
    },
  });
}
