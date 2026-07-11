# Architecture Decision Records

This folder contains the formal record of *why*, not just *what*, for every
significant architectural decision in this project. Each ADR is immutable
once accepted — if a decision is later reversed, a new ADR supersedes the
old one; old ADRs are never edited to pretend the original reasoning didn't
happen.

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-001](./ADR-001-use-mongodb.md) | Use MongoDB instead of a relational database | Accepted |
| [ADR-002](./ADR-002-event-driven-worker-separation.md) | Event-driven backend with separate API and worker processes | Accepted |
| [ADR-003](./ADR-003-blockchain-source-of-truth.md) | Blockchain as single source of truth; read/write path separation | Accepted |
| [ADR-004](./ADR-004-blockchain-service-layer.md) | Centralized Blockchain Service Layer | Accepted |
| [ADR-005](./ADR-005-contract-structure-and-access-control.md) | Single contract, non-upgradeable, role-based access control | Accepted |
| [ADR-006](./ADR-006-explicit-election-finalization.md) | Election state machine with explicit finalization transaction | Accepted |
| [ADR-007](./ADR-007-analytics-trigger-direct-enqueue.md) | Analytics rollup trigger: direct BullMQ enqueue instead of MongoDB Change Streams | Accepted |

## Decisions accepted as documented, without a dedicated ADR

The following items from the architecture document's final approval list
(Section 24) were confirmed as-is, with reasoning already fully captured in
the architecture document itself. They're listed here for traceability
rather than duplicated into their own ADR files, since no alternative
design was seriously weighed against the documented one:

- **On-chain vote privacy is out of scope for v1** — see Section 12
  ("Known limitation") and Section 22 (Future Enhancements: ZK proofs,
  commit-reveal).
- **Registration approval requires an on-chain transaction per voter** —
  see Section 5 ("Should users register on-chain or off-chain?").
- **Sepolia testnet only, no mainnet deployment** — see Section 5
  ("Why Sepolia Testnet?") and Section 19.
- **No real-world legal election-compliance claims** — see Section 17's
  framing of the AUDIT log as demonstrating a pattern, not satisfying
  actual regulatory compliance.
- **No dedicated message broker beyond BullMQ/Redis** — see Section 24's
  complexity-budget reasoning. (The message itself originally named
  MongoDB Change Streams as the analytics-rollup trigger specifically;
  that part is superseded by [ADR-007](./ADR-007-analytics-trigger-direct-enqueue.md).)
- **Five-tier role hierarchy (Guest → Wallet User → Verified Voter →
  Election Administrator → System Administrator)** — see Section 13 in
  full.

## Adding a new ADR

Use the existing files as the template: **Status**, **Context**,
**Decision**, **Rationale**, **Alternatives Considered**, **Consequences**.
Number sequentially; never reuse a number even if an ADR is superseded.