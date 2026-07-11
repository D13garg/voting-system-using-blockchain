# ADR-003: Blockchain as Single Source of Truth; Explicit Read/Write Path Separation

## Status
Accepted — Architecture v3.0

## Context
A voting system's core value proposition — tamper-resistance and public
verifiability — only holds if there is exactly one authoritative record of
votes, eligibility, and election state. At the same time, reading that
authoritative state directly from the chain on every page load is slow
(RPC latency) and expensive (rate-limited free-tier RPC quota,
gas-expensive on-chain loops).

## Decision
- The blockchain is the **only** authoritative source for: voter
  eligibility, vote choices and tallies, election existence/timing/state,
  and admin role assignments (full table in Section 11).
- **Write path** (always): `Wallet → Smart Contract → Blockchain`. Every
  state-changing action is a transaction signed directly by a user's or
  admin's wallet. The backend is never a submitter of votes or registrations
  on anyone's behalf — at most it prepares calldata for the wallet to sign.
- **Read path** (primarily): `Blockchain Events → Worker (listener) →
  MongoDB → Frontend (via API)`. Dashboards, lists, and tallies are served
  from MongoDB, which the worker keeps converged with chain events.
- Every MongoDB document derived from chain data carries enough provenance
  (`txHash`, `blockNumber`) to be independently re-verified against the
  chain at any time — MongoDB is a fast mirror, never a parallel authority.

## Rationale
- Without this separation, every dashboard load would require many RPC view
  calls (per-candidate tallies, per-voter eligibility), which is both slow
  and likely to exhaust free-tier RPC rate limits.
- Keeping the backend structurally incapable of writing votes or
  registrations directly (rather than merely "not doing so by convention")
  is what makes the tamper-resistance claim credible — there's no code path
  where a backend compromise could forge a vote.
- This is the dominant pattern in real dApps, and a deliberate design
  decision worth being able to explain in an interview: "why isn't the vote
  stored in your database first and synced to chain later?" has a concrete
  answer (it would make the database the actual source of truth, which
  defeats the purpose of using a blockchain at all).

## Alternatives Considered
**Backend-mediated writes** (user submits to backend, backend submits the
transaction) — Rejected outright. This would require the backend to hold a
signing key with write privileges on behalf of users, which both centralizes
trust (exactly what the system claims not to do) and introduces a custody/
key-management problem with no corresponding benefit.

**Always reading directly from chain, no MongoDB mirror** — Simpler, fewer
moving parts. Rejected for performance reasons (Section 2) — acceptable for
a single contract-read demo, not for dashboards showing multiple elections,
candidates, and live tallies simultaneously.

## Consequences
- Any new feature must be evaluated against this split before
  implementation: "is this a write (must go wallet → contract) or a read
  (should be served from MongoDB)?" Conflating the two anywhere is an
  architectural violation, not a style preference.
- The worker (ADR-002) becomes a critical-path component for read freshness;
  if it falls behind, the frontend shows stale-but-not-wrong data (mitigated
  by the reconciliation job in Section 8), never incorrect-but-fresh data.
- The Blockchain Service Layer (ADR-004) is the only code path permitted to
  initiate the rare backend-side read calls (e.g., gas estimation previews),
  keeping this boundary enforceable in one place.
