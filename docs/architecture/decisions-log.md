# Implementation Kickoff — Decisions Log

This is a quick-reference summary of the items confirmed during the
implementation-approval round, before Phase 1 began. For full reasoning,
see the linked ADRs. For the complete architecture, see
[`architecture.md`](./architecture.md) in this same folder — that file is
the canonical, complete v3.0 document and is kept in sync as the project
progresses.

| # | Open Item (Section 24 of architecture.md) | Resolution | Reasoning |
|---|---|---|---|
| 1 | Single contract vs. Factory pattern | **Single contract** | [ADR-005](./ADR/ADR-005-contract-structure-and-access-control.md) |
| 2 | Upgradeable vs. immutable contracts | **Non-upgradeable V1**, versioned redeployment later | [ADR-005](./ADR/ADR-005-contract-structure-and-access-control.md) |
| 3 | Ownable vs. AccessControl | **AccessControl** (role-based) | [ADR-005](./ADR/ADR-005-contract-structure-and-access-control.md) |
| 4 | API + Worker: one process or two | **Two separate processes** | [ADR-002](./ADR/ADR-002-event-driven-worker-separation.md) |
| 5 | On-chain vote privacy | Out of scope v1 (architecture.md Section 12/22) | Confirmed as documented |
| 6 | Registration approval mechanism | On-chain tx per voter, no batching v1 | Confirmed as documented |
| 7 | Network scope | Sepolia only, no mainnet | Confirmed as documented |
| 8 | Legal/compliance claims | None — educational system | Confirmed as documented |
| 9 | Database choice | **MongoDB** | [ADR-001](./ADR/ADR-001-use-mongodb.md) |
| 10 | Message broker | None beyond BullMQ/Redis; analytics rollups trigger via direct enqueue from `eventSync.ts`, not MongoDB Change Streams (superseded from the original Change-Streams wording — standalone MongoDB in `docker-compose.yml` doesn't support them) | [ADR-007](./ADR/ADR-007-analytics-trigger-direct-enqueue.md) |
| 11 | Role hierarchy granularity | Five-tier, as designed | Confirmed as documented |
| 12 | `Voting Ended → Result Finalized` transition (new, refines Section 16) | **Explicit `finalizeElection()` admin transaction** | [ADR-006](./ADR/ADR-006-explicit-election-finalization.md) |
| 13 | ADR documentation strategy (new, refines Section 24's final-polish list) | **Write ADRs before Phase 1 scaffolding** | This log + `ADR/` |

## What this means for implementation

None of the above change the architecture's structure, philosophy, or
technology constraints — every resolution either confirms the document's
own stated recommendation or selects between two options the document had
already explicitly weighed (Section 24's approval list). Phase 1
(Environment Setup) proceeded on this basis; see the repository root
`README.md` for current build/run instructions.