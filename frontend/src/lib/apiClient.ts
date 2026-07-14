// Thin backend API client. `credentials: "include"` on every request is
// not optional — the backend's SIWE session is an httpOnly cookie
// (auth.service.ts) and app.ts's CORS is configured with an exact origin +
// credentials:true specifically to support this (see app.ts's own header
// comment on why cors() with no options silently breaks this flow). Every
// call site gets this for free by going through this client rather than
// calling fetch() directly.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

/**
 * Every backend error response is `{ error: { code, message } }`
 * (errorHandler.ts's shape) — parsed here into ApiError so every call
 * site gets a typed, catchable error instead of re-parsing the body
 * itself.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const errorBody = data as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error?.code,
      errorBody?.error?.message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return data as T;
}
