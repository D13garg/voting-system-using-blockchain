// Shared types for the Candidate module (architecture Section 7.1:
// "candidate metadata, bios, IPFS CID references").
//
// SCOPE NOTE: Election.sol's Candidate struct has only name, metadataURI,
// and voteCount - there is no bio field on-chain at all, and no path to
// add one short of a contract redeploy. `bio` is therefore Mongo-only,
// off-chain-authoritative data, not a cache of anything on-chain.
// `metadataURI` is still returned as the raw on-chain string. Since the
// IPFS module (added after this comment was first written - see
// candidate.service.ts's current header) treats metadataURI as a direct
// image CID with no manifest indirection, `imageUrl` alongside it is
// pure string templating (modules/ipfs's resolveIpfsUrl), not a second
// network call or a cache of anything - see candidate.service.ts.
//
// SCOPE NOTE 2: this module deliberately does NOT return voteCount.
// Vote tallying is the Voting module's domain per architecture Section
// 7.1's own split ("Voting - indexed vote events, tally queries") -
// GET /elections/:id/results is the canonical place for vote counts.
// A little field overlap (candidateId/name/metadataURI appearing in both
// modules' responses) is expected and fine: each domain module reads
// what it needs live from the chain independently, same
// no-cross-module-Mongo-coupling pattern the Admin module already
// established relative to Election.

export interface CandidateSummary {
  candidateId: number;
  name: string;
  metadataURI: string;
  /** Null when no admin has set a bio for this candidate yet. */
  bio: string | null;
  /** Null when metadataURI is empty - nothing to resolve into a URL. */
  imageUrl: string | null;
}