// Checkpoint-based event polling (Phase 3 design decision: polling via
// getLogs, not WebSocket subscriptions - see the design discussion for why
// this directly reuses the same mechanism the architecture's worker
// reconciliation job already assumes, Section 8).
//
// ============================================================================
// DELIVERY GUARANTEE: AT-LEAST-ONCE. ALL CONSUMERS MUST BE IDEMPOTENT.
// ============================================================================
// This module's polling loop does NOT guarantee exactly-once delivery of
// any event log. The same log can be delivered more than once, for two
// reasons:
//   1. Checkpoint overlap by design: getNewLogs() below deliberately
//      re-includes the checkpoint's own block in the next poll's fromBlock
//      (see the comment on lastProcessedBlock below), to defend against
//      the edge case where a block briefly appeared final and then was
//      reorganized - a small amount of guaranteed overlap is the safer
//      failure mode than ever risking a skipped block.
//   2. Crash recovery: if the worker (Phase 6) crashes after fetching logs
//      but before successfully persisting the new checkpoint, the next
//      startup will re-fetch and redeliver the same range of logs.
//
// Every consumer of getNewLogs() - which in this codebase means the
// worker's chain-event job handlers built in Phase 6 - MUST treat event
// processing as idempotent. Concretely, this is enforced at the storage
// layer: IndexedVoteEvent's unique index on {txHash, logIndex} (architecture
// Section 10) makes a duplicate insert attempt a no-op (upsert) rather than
// a duplicate record. This module's job is simply to never assume the
// inverse - it must not skip blocks to avoid redelivery, since a missed
// block is strictly worse than a redelivered one.

import type { AbiEvent, Log, PublicClient } from "viem";
import { getPublicClient } from "./provider.js";

export interface LogSyncCheckpoint {
  /** The last block number that was successfully processed (inclusive). */
  lastProcessedBlock: bigint;
}

export interface LogSyncResult {
  logs: Log[];
  /**
   * The checkpoint to persist after successfully processing `logs`.
   * Callers must not advance their own checkpoint past this value
   * preemptively - only after the logs have actually been handled.
   */
  newCheckpoint: LogSyncCheckpoint;
}

/**
 * Fetches all logs for `address` between the checkpoint and the chain's
 * current head, for the given event signature (passed as a viem `event`
 * ABI item so this function stays contract-agnostic - both
 * Election.sol's VoteCast/ElectionCreated/etc and VoterRegistry.sol's
 * VoterRegistered/VoterRemoved go through this same helper).
 *
 * `event` is typed as viem's `AbiEvent` directly. An earlier version of
 * this signature derived the type from
 * `Parameters<PublicClient["getLogs"]>[0]` to avoid an extra import -
 * but `getLogs` is an overloaded method, and TypeScript's `Parameters<>`
 * on an overloaded function resolves only the last overload, which made
 * that conditional type resolve to `never` for any real event argument.
 * Nothing caught this until the Phase 6 worker (src/modules/indexing/
 * eventSync.ts) became this function's first actual caller with a
 * concrete event - fixed by using viem's own exported `AbiEvent` type
 * instead of re-deriving it.
 *
 * Re-fetches starting from `checkpoint.lastProcessedBlock` itself (not
 * lastProcessedBlock + 1) - this is the deliberate at-least-once overlap
 * described in this file's header comment. Callers will see the same
 * last-processed block's logs again on every call until the checkpoint
 * advances past it; this is intentional and must be handled idempotently
 * by the caller, not worked around here.
 */
export async function getNewLogs(params: {
  address: `0x${string}`;
  event: AbiEvent;
  checkpoint: LogSyncCheckpoint;
  client?: PublicClient;
}): Promise<LogSyncResult> {
  const client = params.client ?? getPublicClient();

  const currentBlock = await client.getBlockNumber();

  const logs = await client.getLogs({
    address: params.address,
    event: params.event,
    fromBlock: params.checkpoint.lastProcessedBlock,
    toBlock: currentBlock,
  });

  return {
    logs,
    newCheckpoint: { lastProcessedBlock: currentBlock },
  };
}

/**
 * Polling interval recommendation for the worker (Phase 6). Sepolia's
 * average block time is roughly 12 seconds; polling faster than that
 * wastes RPC quota on requests that will almost always return nothing new,
 * while polling much slower delays event processing without any
 * compensating benefit (the frontend's own UX never depends on this
 * loop's speed - see architecture Section 3.1, the voter's own UI updates
 * from their transaction receipt directly, not from waiting on the
 * worker). 15 seconds balances "close to one block" against "don't
 * hammer the RPC provider."
 */
export const RECOMMENDED_POLL_INTERVAL_MS = 15_000;