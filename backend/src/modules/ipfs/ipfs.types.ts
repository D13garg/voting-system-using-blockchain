// Shared types/constants for the IPFS module (architecture Section
// 7.1/20). See IIpfsClient.ts's header comment for why this module's
// scope is upload-only, with resolution being pure string templating.

/**
 * Approved design decision: image files only (see ipfs.service.ts's
 * uploadCandidateImage). These three cover the realistic candidate-photo
 * case without accepting arbitrary file types a browser <img> tag can't
 * render directly.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * 5 MiB. A generous ceiling for a single candidate photo - large enough
 * for an unedited phone photo, small enough that a single upload can't
 * meaningfully strain the free-tier pinning quota this project targets
 * (Section 2's Cost constraint: "free IPFS pinning").
 */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export interface IpfsUploadResult {
  cid: string;
  url: string;
}