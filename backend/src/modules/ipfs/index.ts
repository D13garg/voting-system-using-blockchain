// Public surface of the IPFS module. Same lazily-constructed-singleton +
// test-seam pattern as modules/blockchain/index.ts's
// getElectionContractClient/_setElectionContractClientForTests, for the
// same two reasons: callers (ipfs.routes.ts) don't need to know or care
// which IIpfsClient implementation is active, and tests can inject a
// fake one with no real network call to Pinata.

export type { IIpfsClient, IpfsPinInput, IpfsPinResult } from "./IIpfsClient.js";
export { PinataIpfsClient } from "./PinataIpfsClient.js";
export { IpfsError } from "./errors.js";
export { resolveIpfsUrl, uploadCandidateImage } from "./ipfs.service.js";
export type { UploadableFile } from "./ipfs.service.js";
export { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_SIZE_BYTES } from "./ipfs.types.js";
export type { IpfsUploadResult } from "./ipfs.types.js";

import { PinataIpfsClient } from "./PinataIpfsClient.js";
import type { IIpfsClient } from "./IIpfsClient.js";

let defaultIpfsClient: IIpfsClient | undefined;

export function getIpfsClient(): IIpfsClient {
  defaultIpfsClient ??= new PinataIpfsClient();
  return defaultIpfsClient;
}

/**
 * Test-only seam, same purpose as blockchain/index.ts's equivalent
 * functions. Never called from non-test code.
 */
export function _setIpfsClientForTests(client: IIpfsClient | undefined): void {
  defaultIpfsClient = client;
}