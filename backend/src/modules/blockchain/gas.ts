// Gas estimation helpers (ADR-004 Section 7.2: "exposed for frontend
// 'prepare transaction' UX can call through the API if needed").
//
// These are read-only estimates against the current chain state - they do
// not submit anything and never require a signer. Used by an API endpoint
// (Phase 5's Election/Voting module) that lets the frontend show "this
// will cost approximately X gas" before prompting the wallet to sign,
// per architecture Section 9's mention of gas estimation in the voting
// flow.

import { encodeFunctionData, type PublicClient } from "viem";
import electionAbi from "../../../../shared/abi/Election.json" with { type: "json" };
import voterRegistryAbi from "../../../../shared/abi/VoterRegistry.json" with { type: "json" };
import { env } from "../../config/env.js";
import { getPublicClient } from "./provider.js";

/**
 * Estimates gas for a vote() call without requiring the voter's own
 * signature - viem's estimateGas can simulate a call "as if" sent from a
 * given address without that address actually signing anything. The
 * frontend calls this (via a Phase 5 API endpoint) with the connected
 * wallet's address, before that wallet is asked to actually sign and
 * submit the real transaction.
 */
export async function estimateVoteGas(params: {
  electionId: bigint;
  candidateId: bigint;
  fromAddress: `0x${string}`;
  client?: PublicClient;
}): Promise<bigint> {
  const client = params.client ?? getPublicClient();

  return client.estimateGas({
    account: params.fromAddress,
    to: env.CONTRACT_ADDRESS_ELECTION as `0x${string}`,
    data: encodeFunctionData({
      abi: electionAbi,
      functionName: "vote",
      args: [params.electionId, params.candidateId],
    }),
  });
}

/**
 * Estimates gas for a registerVoter() call. Used by the Admin module's
 * registration-approval UI to preview cost before the admin's wallet
 * signs the actual transaction (architecture Section 14, step 4).
 */
export async function estimateRegisterVoterGas(params: {
  electionId: bigint;
  voterAddress: `0x${string}`;
  fromAddress: `0x${string}`;
  client?: PublicClient;
}): Promise<bigint> {
  const client = params.client ?? getPublicClient();

  return client.estimateGas({
    account: params.fromAddress,
    to: env.CONTRACT_ADDRESS_VOTER_REGISTRY as `0x${string}`,
    data: encodeFunctionData({
      abi: voterRegistryAbi,
      functionName: "registerVoter",
      args: [params.electionId, params.voterAddress],
    }),
  });
}
