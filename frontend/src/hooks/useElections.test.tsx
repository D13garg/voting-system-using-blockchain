import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useElections } from "./useElections.js";
import * as apiClient from "../lib/apiClient.js";

function wrapper({ children }: PropsWithChildren): JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useElections", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters out draft elections (electionId: null) — this slice's scope decision", async () => {
    vi.spyOn(apiClient, "apiFetch").mockResolvedValue({
      elections: [
        { id: "1", electionId: null, title: "Draft one", description: "", state: "draft", createdBy: "0x1", createdAt: "2026-01-01" },
        { id: "2", electionId: 7, title: "Real election", description: "", state: "voting_active", createdBy: "0x1", createdAt: "2026-01-01" },
      ],
    });

    const { result } = renderHook(() => useElections(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.id).toBe("2");
  });

  it("surfaces a fetch failure as an error state", async () => {
    vi.spyOn(apiClient, "apiFetch").mockRejectedValue(new apiClient.ApiError(500, undefined, "boom"));

    const { result } = renderHook(() => useElections(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
