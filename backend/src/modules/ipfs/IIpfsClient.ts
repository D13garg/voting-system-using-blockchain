// IPFS pinning client interface (architecture Section 7.1/20 reserves
// modules/ipfs/ for exactly this; Section 8's diagram shows the backend
// as the thing that "pins / fetches" against IPFS, holding the pinning
// provider's credentials so they never reach the browser).
//
// Same interface-first rationale as IElectionContractClient.ts:
//
// 1. Testability - a test double implementing this interface can be
//    handed to ipfs.routes.ts's tests with no real network call to a
//    pinning provider, matching this project's established pattern for
//    every other module that talks to an external system.
// 2. Provider swapping - Pinata was chosen for PinataIpfsClient (see its
//    own header comment for why), but nothing outside this module
//    depends on Pinata specifically. A future web3.storage- or
//    self-hosted-node-backed implementation of this same interface could
//    be swapped in without any caller changing.
//
// SCOPE (approved design decision): this interface only pins files
// (candidate images). It deliberately does NOT include a "fetch/resolve"
// method - per the approved design, a Candidate's metadataURI is treated
// as a direct image CID, and turning a CID into a displayable URL is pure
// string templating against IPFS_GATEWAY_URL (see ipfs.service.ts's
// resolveIpfsUrl), not an operation that needs a network call or a
// provider-specific client at all. Don't add a resolve/fetch method here
// unless a real future need (e.g. a JSON manifest layer) actually
// requires fetching content rather than just linking to it.

export interface IpfsPinInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface IpfsPinResult {
  /** The raw CID returned by the pinning provider, e.g. "bafybeigd...". */
  cid: string;
}

export interface IIpfsClient {
  pinFile(input: IpfsPinInput): Promise<IpfsPinResult>;
}