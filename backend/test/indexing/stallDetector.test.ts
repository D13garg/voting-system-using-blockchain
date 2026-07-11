// Tests for the pure stall-detection state machine
// (src/modules/indexing/stallDetector.ts). Deliberately has ZERO
// dependency on Mongo/mongodb-memory-server (unlike eventSync.test.ts in
// this same directory) - see that file's header and HANDOFF.md's
// documented fastdl.mongodb.org sandbox restriction. This file exercises
// the actual state-transition logic behind gap #5's CRITICAL alert
// directly, in-sandbox, with no environment caveats.

import { describe, expect, it } from "vitest";
import { evaluateStall, initialStallDetectorState } from "../../src/modules/indexing/stallDetector.js";

const THRESHOLD_MS = 600_000; // matches WORKER_STALL_CRITICAL_MS's default

describe("stallDetector", () => {
  describe("initialStallDetectorState", () => {
    it("starts with no known block and the given timestamp, not alerted", () => {
      const state = initialStallDetectorState(1_000);
      expect(state).toEqual({ lastAdvancedBlock: null, lastAdvancedAt: 1_000, stallAlerted: false });
    });
  });

  describe("evaluateStall", () => {
    it("treats the very first observed block as an advance, not a stall", () => {
      const state = initialStallDetectorState(1_000);
      const result = evaluateStall(state, 100n, 1_000, THRESHOLD_MS);

      expect(result.nextState).toEqual({ lastAdvancedBlock: 100n, lastAdvancedAt: 1_000, stallAlerted: false });
      expect(result.shouldLogStall).toBe(false);
      expect(result.shouldLogRecovery).toBe(false);
    });

    it("does not log a stall while the checkpoint keeps advancing, however slowly", () => {
      let state = initialStallDetectorState(0);
      let result = evaluateStall(state, 100n, 0, THRESHOLD_MS);
      state = result.nextState;

      // Advances again just before the threshold would otherwise fire.
      result = evaluateStall(state, 101n, THRESHOLD_MS - 1, THRESHOLD_MS);
      state = result.nextState;

      expect(result.shouldLogStall).toBe(false);
      expect(state.lastAdvancedBlock).toBe(101n);
      expect(state.lastAdvancedAt).toBe(THRESHOLD_MS - 1);
    });

    it("does not log a stall before the threshold elapses with no advance", () => {
      const state = { lastAdvancedBlock: 100n, lastAdvancedAt: 0, stallAlerted: false };
      const result = evaluateStall(state, 100n, THRESHOLD_MS - 1, THRESHOLD_MS);

      expect(result.shouldLogStall).toBe(false);
      expect(result.stalledForMs).toBe(THRESHOLD_MS - 1);
    });

    it("logs a stall exactly once when the threshold is first crossed", () => {
      const state = { lastAdvancedBlock: 100n, lastAdvancedAt: 0, stallAlerted: false };

      const first = evaluateStall(state, 100n, THRESHOLD_MS, THRESHOLD_MS);
      expect(first.shouldLogStall).toBe(true);
      expect(first.nextState.stallAlerted).toBe(true);

      // Still stalled on the next poll cycle - must not log again.
      const second = evaluateStall(first.nextState, 100n, THRESHOLD_MS + 15_000, THRESHOLD_MS);
      expect(second.shouldLogStall).toBe(false);
      expect(second.nextState.stallAlerted).toBe(true);
    });

    it("logs a recovery exactly once when the checkpoint advances again after an alerted stall", () => {
      const state = { lastAdvancedBlock: 100n, lastAdvancedAt: 0, stallAlerted: true };

      const result = evaluateStall(state, 105n, THRESHOLD_MS + 30_000, THRESHOLD_MS);

      expect(result.shouldLogRecovery).toBe(true);
      expect(result.shouldLogStall).toBe(false);
      expect(result.nextState).toEqual({
        lastAdvancedBlock: 105n,
        lastAdvancedAt: THRESHOLD_MS + 30_000,
        stallAlerted: false,
      });
    });

    it("does not log a recovery on an ordinary (never-stalled) advance", () => {
      const state = { lastAdvancedBlock: 100n, lastAdvancedAt: 0, stallAlerted: false };
      const result = evaluateStall(state, 101n, 15_000, THRESHOLD_MS);

      expect(result.shouldLogRecovery).toBe(false);
    });

    it("treats a null current block (no checkpoints exist yet) as no advance, never as a crash", () => {
      const state = initialStallDetectorState(0);
      const result = evaluateStall(state, null, THRESHOLD_MS, THRESHOLD_MS);

      expect(result.shouldLogStall).toBe(true);
      expect(result.nextState.lastAdvancedBlock).toBeNull();
    });

    it("never regresses lastAdvancedBlock if a later read is spuriously lower", () => {
      const state = { lastAdvancedBlock: 200n, lastAdvancedAt: 0, stallAlerted: false };
      const result = evaluateStall(state, 150n, 1_000, THRESHOLD_MS);

      expect(result.nextState.lastAdvancedBlock).toBe(200n);
      expect(result.stalledForMs).toBe(1_000);
    });
  });
});