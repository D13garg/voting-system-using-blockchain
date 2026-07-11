// Concrete IIpfsClient implementation targeting Pinata's REST API.
//
// APPROVED DESIGN DECISION: Pinata over web3.storage. env.ts already
// declares IPFS_API_KEY/IPFS_API_SECRET - a plain key+secret pair, which
// is exactly Pinata's classic auth model (sent as the
// pinata_api_key/pinata_secret_api_key headers below). web3.storage's
// w3up-client uses an entirely different DID/UCAN-based auth flow that
// would require reshaping those already-committed env vars for no
// concrete benefit here. Pinata also exposes a plain REST endpoint, so
// this class needs no vendor SDK - just fetch() and FormData, consistent
// with how lean the rest of this backend's external integrations are.
//
// KNOWN IN-SANDBOX LIMITATION (same discipline as HANDOFF.md's Hardhat/
// MongoDB network restrictions): api.pinata.cloud is not in this
// sandbox's network egress allowlist, so a real call through this class
// cannot be verified here - only via a fake IIpfsClient test double (see
// ipfs.test.ts). Real end-to-end upload verification needs to happen on
// a machine with real network access to Pinata, with a real
// IPFS_API_KEY/IPFS_API_SECRET pair.

import { env } from "../../config/env.js";
import { IpfsError } from "./errors.js";
import type { IIpfsClient, IpfsPinInput, IpfsPinResult } from "./IIpfsClient.js";

const PINATA_PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

interface PinataPinFileResponse {
  IpfsHash: string;
}

function isPinataPinFileResponse(value: unknown): value is PinataPinFileResponse {
  return typeof value === "object" && value !== null && typeof (value as { IpfsHash?: unknown }).IpfsHash === "string";
}

export class PinataIpfsClient implements IIpfsClient {
  async pinFile(input: IpfsPinInput): Promise<IpfsPinResult> {
    const formData = new FormData();
    // Buffer -> Blob: Node 20's global Blob accepts Buffer directly as a
    // BlobPart. The filename passed to formData.append is what Pinata
    // records as pinata_metadata.name; it has no bearing on the returned
    // CID.
    formData.append("file", new Blob([input.buffer], { type: input.mimeType }), input.filename);

    let response: Response;
    try {
      response = await fetch(PINATA_PIN_FILE_URL, {
        method: "POST",
        headers: {
          pinata_api_key: env.IPFS_API_KEY,
          pinata_secret_api_key: env.IPFS_API_SECRET,
        },
        body: formData,
      });
    } catch (cause) {
      throw new IpfsError("Network error while contacting the IPFS pinning provider.", cause);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable response body>");
      throw new IpfsError(`IPFS pinning provider returned ${response.status}: ${body}`, undefined);
    }

    const data: unknown = await response.json();
    if (!isPinataPinFileResponse(data)) {
      throw new IpfsError("IPFS pinning provider returned an unexpected response shape.", data);
    }

    return { cid: data.IpfsHash };
  }
}