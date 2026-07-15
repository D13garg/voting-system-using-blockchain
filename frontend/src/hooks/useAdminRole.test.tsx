import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useAdminRole } from "./useAdminRole.js";
import * as apiClient from "../lib/apiClient.js";

function wrapper({ children }: PropsWithChildren): JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useAdminRole", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not fetch when not authenticated", () => {
    const spy = vi.spyOn(apiClient, "apiFetch");
    renderHook(() => useAdminRole(false), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches once authenticated", async () => {
    const spy = vi.spyOn(apiClient, "apiFetch").mockResolvedValue({ isElectionAdministrator: true });
    renderHook(() => useAdminRole(true), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/admin/me/role"));
  });
});
