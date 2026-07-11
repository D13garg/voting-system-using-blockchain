// Stalled-worker CRITICAL alert (architecture Section 17's own canonical
// example: "Worker has not processed a new block in 10 minutes").
//
// Deliberately split into two pieces:
//   1. This file: a pure, dependency-free function over plain values
//      (bigints/numbers) - no Mongoose, no pino, no I/O. Fully unit
//      testable in-sandbox without mongodb-memory-server, unlike almost
//      everything else this worker touches (see HANDOFF.md's documented
//      fastdl.mongodb.org sandbox restriction).
//   2. worker.ts's checkForWorkerStall(): the thin I/O wrapper that reads
//      the current max checkpoint block from WorkerCheckpointModel and
//      calls into this file, then does the actual logger.fatal()/
//      logger.info() calls based on what this file tells it to do.
//
// "Reuse checkpoint data already written to Mongo" (approved decision)
// means the current block reference comes from WorkerCheckpointModel's
// own lastProcessedBlock column - already updated every poll cycle by
// eventSync.ts's saveCheckpoint() to the real current chain head (see
// modules/blockchain/events.ts's getNewLogs) - rather than a dedicated
// extra client.getBlockNumber() call from here. The MAX across all event
// checkpoints is used deliberately: syncAllEvents() isolates each event
// definition's failures from the others (see its own header comment), so
// one event type erroring must not, by itself, make the WHOLE worker look
// stalled while every other event type is still keeping up fine.

export interface StallDetectorState {
  /** Highest checkpoint block seen advance so far, or null before the first observation. */
  lastAdvancedBlock: bigint | null;
  /** Timestamp (ms) that lastAdvancedBlock was last seen to increase. */
  lastAdvancedAt: number;
  /** Whether a CRITICAL stall log has already been emitted for the current, still-ongoing stall episode. */
  stallAlerted: boolean;
}

export interface StallDetectorResult {
  nextState: StallDetectorState;
  /** True exactly once per stall episode - the poll cycle where the threshold is first crossed. */
  shouldLogStall: boolean;
  /** True exactly once - the poll cycle where the checkpoint advances again after a logged stall. */
  shouldLogRecovery: boolean;
  /** How long (ms) the checkpoint has now gone without advancing, for the log payload. */
  stalledForMs: number;
}

/** Fresh state for worker startup - see worker.ts's bootstrap(). Uses `now` (not epoch 0) so a freshly (re)started worker isn't immediately treated as stalled before its first poll has even run. */
export function initialStallDetectorState(now: number): StallDetectorState {
  return { lastAdvancedBlock: null, lastAdvancedAt: now, stallAlerted: false };
}

/**
 * Pure state transition, called once per poll cycle regardless of whether
 * that cycle's syncAllEvents() itself succeeded or threw - a fully-down
 * RPC provider (which prevents even a single checkpoint write) is exactly
 * the case this alert most needs to catch.
 *
 * @param currentMaxBlock - MAX(lastProcessedBlock) across all
 *   WorkerCheckpoint rows right now, or null if none exist yet (e.g. a
 *   brand new deployment whose very first poll hasn't completed).
 */
export function evaluateStall(
  state: StallDetectorState,
  currentMaxBlock: bigint | null,
  now: number,
  stallThresholdMs: number,
): StallDetectorResult {
  const advanced =
    currentMaxBlock !== null &&
    (state.lastAdvancedBlock === null || currentMaxBlock > state.lastAdvancedBlock);

  if (advanced) {
    return {
      nextState: { lastAdvancedBlock: currentMaxBlock, lastAdvancedAt: now, stallAlerted: false },
      shouldLogStall: false,
      shouldLogRecovery: state.stallAlerted,
      stalledForMs: 0,
    };
  }

  const stalledForMs = now - state.lastAdvancedAt;
  const overThreshold = stalledForMs >= stallThresholdMs;

  return {
    nextState: {
      ...state,
      stallAlerted: state.stallAlerted || overThreshold,
    },
    shouldLogStall: overThreshold && !state.stallAlerted,
    shouldLogRecovery: false,
    stalledForMs,
  };
}