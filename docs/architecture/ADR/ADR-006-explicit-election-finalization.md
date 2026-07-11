# ADR-006: Election State Machine with Explicit Finalization Transaction

## Status
Accepted — confirmed in implementation approval round (refines Section 16)

## Context
Section 16 of the architecture document defines a formal election state
machine (Draft → Registration Open → ... → Voting Ended → Result Finalized
→ Archived) but explicitly left one transition undecided: whether
`Voting Ended → Result Finalized` should be an **explicit on-chain
transaction** (`finalizeElection()`, admin-triggered) or **inferred purely
from `endTime` passing**, with no corresponding transaction.

## Decision
Implement an explicit `finalizeElection()` admin-only transaction as the
mechanism for the `Voting Ended → Result Finalized` transition. Finality is
not inferred purely from timestamp comparison.

## Rationale
- An explicit transaction gives the worker (ADR-002) an unambiguous,
  on-chain event (`ElectionFinalized` or similar) to lock the
  `AnalyticsRollup` document against. Inferring finality from `endTime`
  requires the worker to independently decide "enough time has passed, I'll
  treat this as final," which is a judgment call duplicated off-chain
  rather than a fact read from the chain.
- Block timestamps have minor variance and are technically miner/validator-
  influenced within a tolerance; relying on exact-timestamp comparison for
  something as consequential as "this result is now official" introduces
  unnecessary edge-case risk for very little implementation savings (one
  additional, simple, access-controlled function).
- This directly supports Section 16's own reasoning for why a state machine
  was introduced at all: it should give "an unambiguous signal for when to
  lock in final numbers... versus when tallies are still provisional" — an
  inferred transition is a weaker signal than an emitted event.
- A finalize step also creates a clean point to emit a result-announcement
  notification (Section 8, Notifications module) from a real event, rather
  than a worker-side polling check for "has this election's endTime now
  passed."

## Alternatives Considered
**Infer finality purely from `endTime`** — Marginally simpler (no extra
contract function, no extra admin transaction). Rejected because it
weakens the auditability and unambiguity that motivated introducing the
state machine in the first place, for a negligible implementation savings.

## Consequences
- The `Election` contract needs a `finalizeElection(uint256 electionId)`
  function, restricted to `ELECTION_ADMINISTRATOR_ROLE` (or higher),
  callable only when the election's `endTime` has passed and it has not
  already been finalized.
- The admin dashboard (Section 9) needs a "Finalize Election" action,
  exposed only when the election is in the `Voting Ended` state per the
  state machine's allowed-actions table (Section 16).
- The worker must treat `Result Finalized` as triggered by the
  `ElectionFinalized` event, not by independently checking `endTime`
  against the current block timestamp.
- A finalized election that nobody ever calls `finalizeElection()` on will
  remain in `Voting Ended` indefinitely. This is an acceptable, intentional
  consequence: results remain provisional-but-correct until an admin
  explicitly affirms them, rather than ever silently auto-finalizing.
