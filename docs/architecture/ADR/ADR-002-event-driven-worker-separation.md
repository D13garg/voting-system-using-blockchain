# ADR-002: Event-Driven Backend with Separate API and Worker Processes

## Status
Accepted — Architecture v3.0

## Context
The backend needs to serve fast reads (election lists, tallies, dashboards)
while also reacting to blockchain events (indexing votes, updating
analytics, dispatching notifications). A naive design runs both
responsibilities inside a single Express process: HTTP request handling and
blockchain event listening sharing one event loop and one deployment unit.

## Decision
Split the backend into two independently deployed processes sharing one
codebase and one set of Mongoose models:
1. **API process** — serves HTTP requests, reads from MongoDB only, never
   listens for chain events itself.
2. **Worker process** — listens to blockchain events via the Blockchain
   Service Layer (ADR-004), writes indexed events to MongoDB, runs analytics
   rollups, dispatches notifications, all via a BullMQ/Redis job queue.

The API process never writes to chain-derived collections
(`IndexedVoteEvent`, `AnalyticsRollup`); the worker is the only writer.

## Rationale
- **Independent scaling**: HTTP traffic and chain-event volume are unrelated
  workloads with unrelated scaling triggers. Coupling them means
  over-provisioning one to satisfy the other.
- **Failure isolation**: an RPC provider outage stalling the event listener
  must not stall API responses, which should keep serving cached MongoDB
  reads regardless. The reverse also holds — a traffic spike must not starve
  the listener of event-loop time.
- **Single writer eliminates races**: if multiple API instances each ran
  their own event listener, they would duplicate RPC subscriptions (wasting
  free-tier quota) and risk write races on the same documents. One worker as
  the sole writer of chain-derived data removes this entirely.
- **Standard, low-effort deployment pattern**: Render/Railway support running
  a web service and a worker service from one repo with different start
  commands — this is not unusual infrastructure, just two processes instead
  of one.

## Alternatives Considered
**Single process, listener inside Express** — Simpler to deploy (one
service, no Redis needed for queuing). Rejected because it directly
recreates the failure-coupling and scaling problems above, and because
demonstrating this separation is itself part of the project's resume value
(Section 24) — collapsing it back removes a deliberately-chosen learning
and portfolio signal, not just an implementation detail.

## Consequences
- Two services must be deployed and monitored instead of one (Render/Railway
  API + worker), plus a Redis instance for BullMQ.
- The API and worker must share Mongoose model definitions exactly — any
  schema drift between what the worker writes and what the API expects to
  read is a correctness bug, not just a style issue.
- Local development requires `docker-compose` to run MongoDB, Redis, the API,
  and the worker together (see ADR-006 for the configuration approach that
  keeps both processes pointed at consistent settings).
