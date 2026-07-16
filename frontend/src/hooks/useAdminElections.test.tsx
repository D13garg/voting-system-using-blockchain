import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useAdminElections, isElectionInProgress, MIN_CANDIDATES_FOR_COMPLETE } from "./useAdminElections.js";
import * as apiClient from "../lib/apiClient.js";
import type { ElectionSummary } from "./useElections.js";

function wrapper({ children }: PropsWithChildren): JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeElection(overrides: Partial<ElectionSummary>): ElectionSummary {
  return {
    id: "id",
    electionId: null,
    title: "t",
    description: "",
    state: "draft",
    createdBy: "0x1",
    createdAt: "2026-01-01",
    registrationClosedAt: null,
    registrationClosedBy: null,
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

describe("isElectionInProgress", () => {
  it("is true for a draft (electionId null), regardless of candidate count", () => {
    expect(isElectionInProgress(makeElection({ electionId: null }))).toBe(true);
  });

  it("is true when linked but below the minimum candidate count", () => {
    expect(isElectionInProgress(makeElection({ electionId: 1, candidateCount: MIN_CANDIDATES_FOR_COMPLETE - 1 }))).toBe(
      true,
    );
  });

  it("is false once the minimum candidate count is met", () => {
    expect(isElectionInProgress(makeElection({ electionId: 1, candidateCount: MIN_CANDIDATES_FOR_COMPLETE }))).toBe(
      false,
    );
  });

  it("treats a missing candidateCount as 0 (in progress)", () => {
    expect(isElectionInProgress(makeElection({ electionId: 1, candidateCount: undefined }))).toBe(true);
  });
});

describe("useAdminElections", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not fetch when disabled", () => {
    const spy = vi.spyOn(apiClient, "apiFetch");
    renderHook(() => useAdminElections(false), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches all elections, unfiltered, when enabled", async () => {
    const spy = vi.spyOn(apiClient, "apiFetch").mockResolvedValue({ elections: [] });
    renderHook(() => useAdminElections(true), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/elections"));
  });
});
