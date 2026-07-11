// IPFS module service layer. All real logic lives here, not in
// ipfs.routes.ts - same convention as every other domain module.

import { env } from "../../config/env.js";
import { HttpError } from "../../shared/httpError.js";
import { IpfsError } from "./errors.js";
import type { IIpfsClient } from "./IIpfsClient.js";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_SIZE_BYTES, type IpfsUploadResult } from "./ipfs.types.js";

export interface UploadableFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Turns a raw CID into a URL the frontend can put straight into an <img
 * src>. Approved design decision (see IIpfsClient.ts's header comment):
 * a Candidate's metadataURI IS the image CID directly - no manifest
 * indirection - so this is pure string templating, not a network call.
 * Exported for the Candidate module to use directly on metadataURI
 * values it already has, without needing an IIpfsClient instance at all.
 */
export function resolveIpfsUrl(cid: string): string {
  const gateway = env.IPFS_GATEWAY_URL.endsWith("/") ? env.IPFS_GATEWAY_URL.slice(0, -1) : env.IPFS_GATEWAY_URL;
  return `${gateway}/ipfs/${cid}`;
}

function validateImageUpload(file: UploadableFile): void {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    throw new HttpError(
      400,
      "UNSUPPORTED_IMAGE_TYPE",
      `Unsupported image type "${file.mimetype}". Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(", ")}.`,
    );
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new HttpError(
      400,
      "IMAGE_TOO_LARGE",
      `Image exceeds the maximum allowed size of ${MAX_IMAGE_SIZE_BYTES} bytes.`,
    );
  }
}

export async function uploadCandidateImage(file: UploadableFile, client: IIpfsClient): Promise<IpfsUploadResult> {
  validateImageUpload(file);

  let cid: string;
  try {
    ({ cid } = await client.pinFile({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    }));
  } catch (error) {
    if (error instanceof IpfsError) {
      throw new HttpError(502, "IPFS_UPLOAD_FAILED", `Failed to upload image to IPFS: ${error.message}`);
    }
    throw error;
  }

  return { cid, url: resolveIpfsUrl(cid) };
}