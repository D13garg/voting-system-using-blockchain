import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useMyElections } from "./useMyElections.js";
import * as apiClient from "../lib/apiClient.js";

function wrapper({ children }: PropsWithChildren): JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useMyElections", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not fetch when not authenticated", () => {
    const spy = vi.spyOn(apiClient, "apiFetch");
    renderHook(() => useMyElections(false), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches once authenticated", async () => {
    const spy = vi.spyOn(apiClient, "apiFetch").mockResolvedValue({ elections: [] });
    renderHook(() => useMyElections(true), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/voters/me/elections"));
  });
});
