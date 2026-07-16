// Landing page data hook. Wraps GET /elections (election.routes.ts) in
// React Query, per the Phase 4 scaffold's state-management split (server
// data lives in React Query, never in the Zustand theme store).
//
// SCOPE DECISION (this slice, user's call): draft elections (electionId
// === null — off-chain-only metadata, not yet linked to an on-chain
// createElection() transaction, per election.types.ts) are filtered out
// here, client-side. The public Landing page shows only elections that
// are genuinely on-chain and verifiable — a draft is an admin's
// work-in-progress with no chain backing yet, and showing it publicly
// would undercut the one thing this app is supposed to guarantee (what
// you see here is real, confirmed chain state). Drafts belong in a
// future Admin Dashboard view instead, not here.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";

export type ElectionLifecycleState =
  | "draft"
  | "registration_open"
  | "registration_closed"
  | "voting_active"
  | "voting_ended"
  | "result_finalized"
  | "archived";

export interface ElectionSummary {
  id: string;
  electionId: number | null;
  title: string;
  description: string;
  state: ElectionLifecycleState;
  createdBy: string;
  createdAt: string;
  startTime?: string;
  endTime?: string;
  finalized?: boolean;
  candidateCount?: number;
  registrationClosedAt: string | null;
  registrationClosedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
}

// 15s (user's call) — the mirror this reads from can lag the chain by up
// to RECOMMENDED_POLL_INTERVAL_MS (backend/src/modules/blockchain), so
// this is "check for updates at a reasonable cadence", not a claim of
// real-time chain data.
const REFETCH_INTERVAL_MS = 15_000;

export function useElections(): ReturnType<typeof useQuery<ElectionSummary[], Error>> {
  return useQuery({
    queryKey: ["elections"],
    queryFn: async () => {
      const { elections } = await apiFetch<{ elections: ElectionSummary[] }>("/elections");
      return elections.filter((election) => election.electionId !== null);
    },
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}
