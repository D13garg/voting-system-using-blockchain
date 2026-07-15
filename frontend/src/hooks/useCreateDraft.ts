// Step 1 of the Create Election wizard: POST /elections/draft
// (election.routes.ts). Off-chain only — Section 16's Draft state, no
// wallet interaction yet.
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";
import type { ElectionSummary } from "./useElections.js";

interface CreateDraftInput {
  title: string;
  description: string;
}

export function useCreateDraft(): ReturnType<typeof useMutation<ElectionSummary, Error, CreateDraftInput>> {
  return useMutation<ElectionSummary, Error, CreateDraftInput>({
    mutationFn: (input) =>
      apiFetch<{ election: ElectionSummary }>("/elections/draft", { method: "POST", body: input }).then(
        (r) => r.election,
      ),
  });
}
