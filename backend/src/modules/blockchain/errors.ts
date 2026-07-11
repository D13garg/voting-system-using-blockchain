// Error normalization (ADR-004: "normalizes Viem/RPC errors into a
// consistent internal error type... retries transient RPC failures
// (never deterministic contract reverts)").
//
// Every contract client method (ElectionContractClient,
// VoterRegistryContractClient) routes its errors through normalizeError()
// before they propagate to callers (domain modules, the worker). This is
// the one place in the codebase that knows how to tell "the RPC provider
// timed out, try again" apart from "the contract reverted, this call will
// never succeed no matter how many times you retry it" - every other
// module just receives one of two clearly-typed outcomes and acts
// accordingly, instead of each one re-deriving this classification from
// raw viem error shapes.

import { BaseError, ContractFunctionRevertedError } from "viem";

export type BlockchainErrorKind = "CONTRACT_REVERT" | "TRANSIENT_RPC" | "UNKNOWN";

export class BlockchainError extends Error {
  public readonly kind: BlockchainErrorKind;
  /**
   * The contract's custom error name (e.g. "VoterAlreadyVoted"), when the
   * underlying error is a CONTRACT_REVERT and the revert reason could be
   * decoded against the contract's ABI. Undefined for TRANSIENT_RPC and
   * UNKNOWN errors, and for CONTRACT_REVERT errors where decoding the
   * specific custom error failed (the call still reverted - this just
   * means the *reason* couldn't be matched to a known error in the ABI).
   */
  public readonly revertErrorName?: string;
  public readonly retryable: boolean;
  public override readonly cause: unknown;

  constructor(params: {
    kind: BlockchainErrorKind;
    message: string;
    revertErrorName?: string;
    retryable: boolean;
    cause: unknown;
  }) {
    super(params.message);
    this.name = "BlockchainError";
    this.kind = params.kind;
    this.revertErrorName = params.revertErrorName;
    this.retryable = params.retryable;
    this.cause = params.cause;
  }
}

/**
 * Normalizes any error thrown by a viem contract call (read or write) into
 * a BlockchainError with a clear retryable/non-retryable classification.
 *
 * Classification logic:
 * - A decoded contract revert (the call reached the chain, executed, and
 *   the contract's own logic rejected it - e.g. VoterAlreadyVoted) is
 *   CONTRACT_REVERT and NEVER retryable: the same call with the same
 *   arguments will revert again no matter how many times it's retried,
 *   because the contract's state hasn't changed.
 * - Network-level failures (timeout, connection reset, rate limit, RPC
 *   provider returning a 5xx) are TRANSIENT_RPC and retryable: these say
 *   nothing about whether the call itself would succeed, only that this
 *   particular attempt to reach the chain failed.
 * - Anything that doesn't match a recognized viem error shape is UNKNOWN
 *   and treated as non-retryable by default - the safer default when the
 *   failure mode isn't understood is to surface it rather than silently
 *   retry something that might not be safe to retry (e.g., an unexpected
 *   error during a write call should not be blindly resubmitted, since
 *   that risks a duplicate transaction).
 */
export function normalizeError(error: unknown): BlockchainError {
  if (error instanceof BaseError) {
    const revertError = error.walk((e) => e instanceof ContractFunctionRevertedError);

    if (revertError instanceof ContractFunctionRevertedError) {
      return new BlockchainError({
        kind: "CONTRACT_REVERT",
        message: revertError.data?.errorName
          ? `Contract reverted: ${revertError.data.errorName}`
          : "Contract reverted with an undecoded reason",
        revertErrorName: revertError.data?.errorName,
        retryable: false,
        cause: error,
      });
    }

    if (isTransientRpcError(error)) {
      return new BlockchainError({
        kind: "TRANSIENT_RPC",
        message: `Transient RPC failure: ${error.shortMessage}`,
        retryable: true,
        cause: error,
      });
    }
  }

  return new BlockchainError({
    kind: "UNKNOWN",
    message: error instanceof Error ? error.message : "Unknown blockchain error",
    retryable: false,
    cause: error,
  });
}

/**
 * Heuristic classification of "this looks like a network/provider problem,
 * not a deterministic outcome of the call itself." viem doesn't expose a
 * single canonical "is this retryable" flag, so this checks the error's
 * short message for known transient patterns. Deliberately conservative:
 * an error not matching one of these patterns falls through to UNKNOWN
 * (non-retryable) rather than being assumed safe to retry.
 */
function isTransientRpcError(error: BaseError): boolean {
  const message = error.shortMessage.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("rate limit") ||
    message.includes("econnreset") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("http request failed")
  );
}
