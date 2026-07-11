# ADR-007: Analytics Rollup Trigger — Direct BullMQ Enqueue Instead of MongoDB Change Streams

## Status
Accepted — approved during backend gap-remediation (Gap #6), formalizing a
decision already made and implemented earlier but not previously recorded
as its own ADR. Supersedes the Change-Streams-specific portion of
`decisions-log.md` row #10 ("Message broker: none beyond Change Streams +
BullMQ/Redis. Confirmed as documented").

## Context
Section 8 of the architecture document lists analytics rollup generation
as one of the worker's responsibilities, specifically "reacting to MongoDB
Change Streams." This was not left open the way Section 16's finalization
transition was (see ADR-006) — it was explicitly confirmed during the
implementation-approval round (`decisions-log.md` row #10: "Message
broker: None beyond Change Streams + BullMQ/Redis. Confirmed as
documented").

MongoDB Change Streams require the database to run as a replica set, even
a single-node one. This project's `docker-compose.yml` runs a standalone
`mongo:7` instance for local development, matching the simplicity this
project's infrastructure otherwise favors (no dedicated message broker
beyond BullMQ/Redis, no additional operational surface). Watching a
Change Stream against a standalone instance fails outright — this would
have broken analytics rollups in every local dev environment as shipped,
not just in some edge case.

## Decision
`eventSync.ts` — the worker's single writer of `IndexedVoteEvent` and
`IndexedElection` documents — directly enqueues a BullMQ analytics-rollup
job (`analytics.queue.ts`'s `enqueueRollupRecompute`) immediately after
each write relevant to a rollup (`VoteCast`, `ElectionFinalized`), instead
of a separate Change Stream watcher observing those same writes and
enqueuing on their behalf.

## Rationale
- **Same writer, same trigger point, no replica-set requirement.** The
  single writer a Change Stream would have watched is `eventSync.ts`
  itself. Enqueueing directly from that writer, right after the write it
  would otherwise be reacting to, produces the identical trigger timing
  without requiring MongoDB to run as a replica set anywhere, including
  local dev.
- **Functionally equivalent for this project's actual fan-out needs.**
  Change Streams' main advantage over a direct call is fanning a single
  write out to multiple independent consumers without the writer knowing
  about them. Today there is exactly one consumer (the analytics rollup
  job) and the writer is a single, already-controlled module — the
  fan-out property isn't being used, so paying its operational cost
  (replica set) buys nothing yet.
- **Still fully event-driven, not polled.** The worker reacts to the same
  on-chain events as before; only the specific mechanism connecting "a
  relevant write happened" to "a rollup job was enqueued" changed, not
  the overall reactive architecture ADR-002 established.
- **Lower operational cost, same job-queue properties.** BullMQ's own
  dedup (`jobId: rollup:${electionId}`) and retry/backoff behavior are
  unchanged — Section 8's "queued jobs, not direct function calls inside
  the event handler" property is preserved. Only Change Streams
  specifically, one possible way to trigger that enqueue, was dropped.

## Alternatives Considered
**Run MongoDB as a single-node replica set in `docker-compose.yml` and
implement a real Change Stream watcher**, to match the architecture
document's literal wording. Rejected for this project's current scope: it
adds a real operational requirement (replica set initialization, a
slightly more involved local setup, a new long-lived watcher process or
connection to manage and handle reconnects for) to gain a fan-out
capability nothing in the codebase needs yet. If a genuine second
independent consumer of these writes appears later (e.g. a separate
service that needs to react to the same election/vote writes without
`eventSync.ts` knowing about it), that is a concrete reason to revisit
this decision — not a hypothetical one to pay for now.

## Consequences
- `architecture.md` Section 8 and `decisions-log.md` row #10 are updated
  alongside this ADR to describe the direct-enqueue mechanism as the
  actual, current design, rather than continuing to state the superseded
  Change-Streams wording as fact.
- Any future module that also needs to react to `IndexedVoteEvent`/
  `IndexedElection` writes independently of `eventSync.ts` will need its
  own explicit trigger (another direct call from `eventSync.ts`, or a
  revisit of this ADR to introduce Change Streams for real) — writes to
  those collections are not self-announcing the way a Change Stream
  would make them.
- `docker-compose.yml` continues to run a standalone MongoDB instance;
  no replica-set initialization is required for local development or (as
  currently deployed) production.