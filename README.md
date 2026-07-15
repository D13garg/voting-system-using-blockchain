# Decentralized Voting System

A production-inspired, tamper-resistant voting platform built on Ethereum
(Sepolia testnet). The blockchain is the single source of truth for voter
eligibility, votes, and election state; a domain-driven, event-driven
backend mirrors that state for fast reads without ever being able to write
it.

This project is built to learn blockchain fundamentals deeply (smart
contracts, gas, events, wallet integration, transaction lifecycle) while
also standing as a flagship, resume-quality full-stack project, and as the
architectural foundation for future blockchain-backed systems (see
[Section 23](./docs/architecture/architecture.md#23-modular-architecture-for-reuse)).

## Status

**Phases 1-3 (Environment, Smart Contracts, Blockchain Service Layer) —
complete, fully verified.** **Phase 5 (Backend Domain Modules: Auth,
Election, Voting, Admin, Candidate) — complete.** **Phase 6 (Background
Worker / event indexer) — complete**, and its indexed Mongo collections
are now the primary read path for every domain module (decision (a):
read-migration pass, done). **Phase 4 (Frontend) — all 7 Section 9 pages
built** (Landing, Election Detail, Voter Dashboard, Admin Dashboard,
Create Election, Registration Requests, Archive placeholder), local dev
stack confirmed working end-to-end. Full detail, every design decision,
and current open items are in [`HANDOFF.md`](./HANDOFF.md) — read that,
not this section, for anything beyond a one-line status check.

## Architecture

This project is implemented strictly according to an approved Architecture
Design Document. **Read this before touching any code:**

- [`docs/architecture/architecture.md`](./docs/architecture/architecture.md)
  — the complete, canonical architecture (v3.0). Single source of truth.
- [`docs/architecture/decisions-log.md`](./docs/architecture/decisions-log.md)
  — summary of decisions confirmed at implementation kickoff.
- [`docs/architecture/ADR/`](./docs/architecture/ADR/) — full Architecture
  Decision Records with context, reasoning, alternatives considered, and
  consequences for every significant decision.

If implementation ever reveals a problem with the approved architecture,
that is raised and resolved as a new ADR — the architecture is never
silently changed.

## Project Structure

```
contracts/    Solidity smart contracts (Hardhat) — Phase 2
backend/      Express API + worker processes (domain-driven modules)
frontend/     React + Vite + Wagmi/RainbowKit SPA
shared/       Generated ABIs / TypeChain types, contract addresses
docs/         Architecture document, ADRs, diagrams
```

See [Section 20 of the architecture](./docs/architecture/architecture.md#20-folder-structure)
for the full structure and rationale for every folder.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`corepack enable` or `npm install -g pnpm`)
- Docker + Docker Compose (for MongoDB + Redis locally)

## Setup

```bash
# Install all workspace dependencies
pnpm install

# Copy environment templates and fill in real values
cp backend/.env.example backend/.env

# Start MongoDB + Redis (and, once built, the API + worker containers)
docker compose up -d mongodb redis
```

## Running locally

```bash
# Backend API (hot-reload)
pnpm --filter @dvs/backend dev:api

# Backend worker (hot-reload)
pnpm --filter @dvs/backend dev:worker

# Frontend dev server
pnpm --filter @dvs/frontend dev

# Contracts: local Hardhat node + compile
pnpm --filter @dvs/contracts node      # in one terminal
pnpm --filter @dvs/contracts compile   # in another
```

## Testing

```bash
pnpm --filter @dvs/backend test
pnpm --filter @dvs/contracts test      # once contracts exist (Phase 2)
pnpm --filter @dvs/frontend test
```

## Linting & formatting

```bash
pnpm lint            # across all packages
pnpm format          # Prettier, writes
pnpm format:check    # Prettier, check-only (used in CI)
```

## Why these technology choices?

Every technology decision in this project is justified, not assumed — see
the [Technology Stack section](./docs/architecture/architecture.md#4-technology-stack)
of the architecture document, and the [ADRs](./docs/architecture/ADR/) for
the decisions that involved weighing real alternatives (MongoDB vs.
PostgreSQL, single contract vs. factory pattern, upgradeable vs. immutable
contracts, AccessControl vs. Ownable, separate API/worker processes vs. one
process).

## Known limitation

This system achieves integrity and tamper-resistance, not voter privacy —
vote choices are visible in the public mempool before confirmation. This is
a deliberate, documented scope decision (see
[Section 12](./docs/architecture/architecture.md#12-security-design)), with
anonymous/ZK voting tracked as a [Future Enhancement](./docs/architecture/architecture.md#22-future-enhancements).