// Shared types for the Voting module (architecture Section 7.1:
// "indexed vote events, tally queries, 'has voted' checks").
//
// SCOPE NOTE: this module is entirely read-only. vote() itself is
// wallet-direct (same as Election.sol's createElection()) and
// IElectionContractClient has no write method for it by design - there
// is no transaction for this module to relay, only on-chain state to
// read. See voting.service.ts's header comment for the two things
// deliberately NOT built here yet (per-voter candidate lookup, IPFS
// image resolution) and why.
//
// Also note: unlike Election, this module operates purely in on-chain
// electionId space - it has no Mongo model and no concept of a "draft"
// election. A draft that hasn't been linked to an on-chain electionId
// yet (see election.service.ts) simply has no votes or results to ask
// about.

export interface CandidateResult {
  candidateId: number;
  name: string;
  metadataURI: string;
  voteCount: number;
}

export interface ElectionResults {
  electionId: number;
  totalVotes: number;
  candidates: CandidateResult[];
}

export interface VoteStatus {
  electionId: number;
  address: string;
  hasVoted: boolean;
}