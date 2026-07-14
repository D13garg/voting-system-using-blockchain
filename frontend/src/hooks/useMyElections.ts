// GET /voters/me/elections (admin.routes.ts) — Voter Dashboard's data
// source. See HANDOFF.md's item 10 for the backend-side design decision
// this endpoint is built on (the first inter-domain-module import in the
// backend, an approved coupling). Only enabled once authenticated — the
// endpoint requires a session, same pattern as useHasVoted/useRegistrationStatus.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";
import type { ElectionLifecycleState } from "./useElections.js";
import type { RegistrationRequestStatus } from "./useRegistrationStatus.js";

export interface MyElectionStatus {
  /** Mongo draft id — what the /elections/:id route actually expects (see useElection.ts's header comment on the ID-space split). NOT the same value as electionId below. */
  id: string;
  electionId: number;
  title: string;
  state: ElectionLifecycleState;
  registrationStatus: RegistrationRequestStatus;
  onChainConfirmed: boolean;
  hasVoted: boolean;
}

export function useMyElections(
  isAuthenticated: boolean,
): ReturnType<typeof useQuery<MyElectionStatus[], Error>> {
  return useQuery({
    queryKey: ["my-elections"],
    queryFn: () => apiFetch<{ elections: MyElectionStatus[] }>("/voters/me/elections").then((r) => r.elections),
    enabled: isAuthenticated,
  });
}
