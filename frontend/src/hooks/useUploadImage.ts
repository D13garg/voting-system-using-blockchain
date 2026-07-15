// POST /ipfs/upload (ipfs.routes.ts) — multipart, so this bypasses
// apiClient.ts's apiFetch (which always JSON-stringifies and sets
// Content-Type: application/json) rather than trying to force it through
// that helper. Still keeps credentials:"include" (same httpOnly SIWE
// cookie requirement as every other authenticated call) and the same
// ApiError shape on failure, so callers don't need to know this one
// works differently under the hood.
import { useMutation } from "@tanstack/react-query";
import { ApiError } from "../lib/apiClient.js";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";

interface UploadResult {
  cid: string;
  url: string;
}

async function uploadImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("image", file);
  const response = await fetch(`${API_BASE_URL}/ipfs/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const errorBody = data as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error?.code,
      errorBody?.error?.message ?? `Image upload failed with status ${response.status}`,
    );
  }
  return data as UploadResult;
}

export function useUploadImage(): ReturnType<typeof useMutation<UploadResult, Error, File>> {
  return useMutation<UploadResult, Error, File>({ mutationFn: uploadImage });
}
