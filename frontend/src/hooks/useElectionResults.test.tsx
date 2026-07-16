import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useElectionResults } from "./useElectionResults.js";
import * as apiClient from "../lib/apiClient.js";

function wrapper({ children }: PropsWithChildren): JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useElectionResults", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not fetch while voting is still active (avoids bandwagon effects — approved decision)", () => {
    const spy = vi.spyOn(apiClient, "apiFetch");
    renderHook(() => useElectionResults(7, "voting_active"), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not fetch while voting hasn't started", () => {
    const spy = vi.spyOn(apiClient, "apiFetch");
    renderHook(() => useElectionResults(7, "registration_open"), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches once voting has ended", async () => {
    const spy = vi
      .spyOn(apiClient, "apiFetch")
      .mockResolvedValue({ results: { electionId: 7, totalVotes: 0, candidates: [] } });
    renderHook(() => useElectionResults(7, "voting_ended"), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/elections/7/results"));
  });

  it("fetches once finalized", async () => {
    const spy = vi
      .spyOn(apiClient, "apiFetch")
      .mockResolvedValue({ results: { electionId: 7, totalVotes: 0, candidates: [] } });
    renderHook(() => useElectionResults(7, "result_finalized"), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/elections/7/results"));
  });

  it("still fetches once archived - results shouldn't disappear after archiving", async () => {
    const spy = vi
      .spyOn(apiClient, "apiFetch")
      .mockResolvedValue({ results: { electionId: 7, totalVotes: 0, candidates: [] } });
    renderHook(() => useElectionResults(7, "archived"), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/elections/7/results"));
  });
});
