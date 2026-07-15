import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useRegistrationRequests } from "./useRegistrationRequests.js";
import * as apiClient from "../lib/apiClient.js";

function wrapper({ children }: PropsWithChildren): JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useRegistrationRequests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not fetch when disabled", () => {
    const spy = vi.spyOn(apiClient, "apiFetch");
    renderHook(() => useRegistrationRequests("pending", false), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });

  it("includes the status filter in the query string", async () => {
    const spy = vi.spyOn(apiClient, "apiFetch").mockResolvedValue({ requests: [] });
    renderHook(() => useRegistrationRequests("approved", true), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/admin/registration-requests?status=approved"));
  });

  it("omits the status filter when undefined", async () => {
    const spy = vi.spyOn(apiClient, "apiFetch").mockResolvedValue({ requests: [] });
    renderHook(() => useRegistrationRequests(undefined, true), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/admin/registration-requests"));
  });
});
