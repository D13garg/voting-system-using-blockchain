import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "./apiClient.js";

function mockFetchOnce(response: { status: number; body?: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: () => Promise.resolve(response.body),
    }),
  );
}

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always sends credentials:'include' (required for the httpOnly SIWE session cookie)", async () => {
    mockFetchOnce({ status: 200, body: { ok: true } });
    await apiFetch("/health");
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });

  it("serializes a body as JSON with a Content-Type header when provided", async () => {
    mockFetchOnce({ status: 200, body: { address: "0xabc" } });
    await apiFetch("/auth/siwe", { method: "POST", body: { message: "m", signature: "0x1" } });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ message: "m", signature: "0x1" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns undefined for a 204 response without attempting to parse a body", async () => {
    mockFetchOnce({ status: 204 });
    const result = await apiFetch("/auth/logout", { method: "POST" });
    expect(result).toBeUndefined();
  });

  it("throws ApiError with the backend's error code/message on a non-2xx response", async () => {
    mockFetchOnce({ status: 401, body: { error: { code: "UNAUTHENTICATED", message: "No valid session" } } });
    await expect(apiFetch("/auth/session")).rejects.toMatchObject(
      new ApiError(401, "UNAUTHENTICATED", "No valid session"),
    );
  });

  it("falls back to a generic message if the error body is missing/malformed", async () => {
    mockFetchOnce({ status: 500, body: undefined });
    await expect(apiFetch("/elections")).rejects.toThrow(/status 500/);
  });
});
