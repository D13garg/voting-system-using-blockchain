// Step 3 of the wizard: PATCH /elections/draft/:id/link-onchain
// (election.routes.ts). Tells the backend the result of step 2's
// transaction — the write-path architecture deliberately keeps the
// backend out of the actual createElection() transaction, so it has to
// be told the outcome this way (election.service.ts's own header
// comment on why this endpoint exists at all).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";
import type { ElectionSummary } from "./useElections.js";

interface LinkOnChainInput {
  draftId: string;
  electionId: number;
  transactionHash: `0x${string}`;
}

export function useLinkOnChain(): ReturnType<typeof useMutation<ElectionSummary, Error, LinkOnChainInput>> {
  const queryClient = useQueryClient();
  return useMutation<ElectionSummary, Error, LinkOnChainInput>({
    mutationFn: ({ draftId, electionId, transactionHash }) =>
      apiFetch<{ election: ElectionSummary }>(`/elections/draft/${draftId}/link-onchain`, {
        method: "PATCH",
        body: { electionId, transactionHash },
      }).then((r) => r.election),
    onSuccess: (_data, { draftId }) => {
      void queryClient.invalidateQueries({ queryKey: ["election", draftId] });
    },
  });
}
