// Regression coverage for useAuth.ts's isConnectedRef effect (the wallet-
// disconnect-clears-backend-session fix — see that file's own header
// comment for the full bug this exists to prevent regressing). Re-added
// this session after being dropped from the last delivered zip — see
// HANDOFF.md item 18.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { useAuth } from "./useAuth.js";
import * as apiClient from "../lib/apiClient.js";

// wagmi's exports (useAccount included) are non-configurable — vi.spyOn on
// the module namespace throws "Cannot redefine property" at runtime, the
// same finding RegistrationGate.test.tsx's header comment already
// documents. Mock the whole module instead of spying on one export.
vi.mock("wagmi", () => ({
    useAccount: vi.fn(),
    useChainId: vi.fn(),
    useSignMessage: vi.fn(),
}));

function mockWallet(isConnected: boolean, address = "0xabc"): void {
    vi.mocked(useAccount).mockReturnValue({
        address: isConnected ? address : undefined,
        isConnected,
    } as unknown as ReturnType<typeof useAccount>);
    vi.mocked(useChainId).mockReturnValue(31337);
    vi.mocked(useSignMessage).mockReturnValue({
        signMessageAsync: vi.fn(),
    } as unknown as ReturnType<typeof useSignMessage>);
}

describe("useAuth", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("restores an existing session on mount without forcing a fresh signature", async () => {
        mockWallet(true, "0xabc");
        vi.spyOn(apiClient, "apiFetch").mockResolvedValue({ address: "0xabc" });

        const { result } = renderHook(() => useAuth());

        await waitFor(() => expect(result.current.status).toBe("authenticated"));
        expect(result.current.address).toBe("0xabc");
    });

    it("does not call /auth/logout on cold mount for a never-connected visitor", async () => {
        mockWallet(false);
        const spy = vi.spyOn(apiClient, "apiFetch").mockRejectedValue(new Error("no session"));

        const { result, rerender } = renderHook(() => useAuth());
        await waitFor(() => expect(result.current.status).toBe("idle"));

        // isConnected stays false across a re-render — no true->false transition
        // ever happens, so the logout-clearing effect must never fire. This is
        // the case the isConnectedRef guard exists for (a naive "isConnected
        // === false" check with no ref would wrongly fire here on mount).
        rerender();
        expect(spy).not.toHaveBeenCalledWith("/auth/logout", { method: "POST" });
    });

    it("clears the backend session on a true->false wallet transition, however it happens (e.g. RainbowKit's own account modal, not just this app's own signOut())", async () => {
        mockWallet(true, "0xabc");
        const spy = vi.spyOn(apiClient, "apiFetch").mockImplementation((path: string) => {
            if (path === "/auth/session") return Promise.resolve({ address: "0xabc" });
            if (path === "/auth/logout") return Promise.resolve(undefined);
            return Promise.reject(new Error(`unexpected path ${path}`));
        });

        const { result, rerender } = renderHook(() => useAuth());
        await waitFor(() => expect(result.current.status).toBe("authenticated"));

        // Simulate a disconnect that happens OUTSIDE this app's own signOut() —
        // e.g. RainbowKit's account modal, which only knows about Wagmi's
        // disconnect(), not this app's independent backend session.
        mockWallet(false);
        rerender();

        await waitFor(() => expect(spy).toHaveBeenCalledWith("/auth/logout", { method: "POST" }));
        await waitFor(() => expect(result.current.status).toBe("idle"));
        expect(result.current.address).toBeNull();
    });
});