# ADR-005: Single Contract, Non-Upgradeable, Role-Based Access Control

## Status
Accepted — Architecture v3.0, confirmed in implementation approval round

## Context
Three related contract-design questions needed resolution before Phase 2
(Smart Contracts) could begin: whether to deploy one contract per election
(factory pattern) or a single contract managing all elections; whether
contracts should be upgradeable; and whether access control should use
OpenZeppelin's `Ownable` (single owner) or `AccessControl` (role-based).

## Decision

### Single contract, not factory pattern
One deployed contract (or small set of contracts: `VoterRegistry` +
`Election`) manages all elections via a `mapping(uint256 => Election)`,
rather than deploying a fresh contract per election.

### Non-upgradeable V1
Contracts are immutable once deployed. No proxy pattern (UUPS/Transparent)
in V1. Future contract changes are handled via **versioned redeployment**
(a new V2 contract at a new address, tracked per-election by the
ElectionFactory/registry), not in-place upgrades. See Section 6.1 of the
architecture document for the full migration-path reasoning.

### OpenZeppelin AccessControl, not Ownable
Role-based access control with at least two roles
(`SYSTEM_ADMINISTRATOR_ROLE`, `ELECTION_ADMINISTRATOR_ROLE`), matching the
five-tier role hierarchy already defined in Section 13.

## Rationale

**Single contract**: No election in this system needs isolation from
another election's compromise — they are independent business logic, not
independent trust domains. A factory's per-election deployment gas cost has
no corresponding security or learning benefit at this scope. Mapping-of-
structs is also a more broadly transferable Solidity pattern than
contract-deploying-contracts.

**Non-upgradeable**: Proxy patterns introduce storage-collision risk and a
harder audit story disproportionate to this project's goals. Immutability
is also a feature, not just a limitation to engineer around — "once
deployed, nobody can change the rules mid-election" is core to the
tamper-resistance narrative this project is built to demonstrate.

**AccessControl over Ownable**: The role hierarchy (Section 13) requires
two genuinely distinct on-chain privilege levels. `Ownable` provides exactly
one privileged address; using it would mean either faking multi-role logic
with ad hoc mappings (reimplementing AccessControl poorly) or collapsing the
role hierarchy to fit Ownable's shape, which would contradict Section 13 as
already designed.

## Alternatives Considered
- **Factory pattern** — retained as a documented stretch goal (Section 6),
  not discarded, in case per-election isolation becomes valuable later.
- **UUPS upgradeable proxy** — retained as a documented future enhancement
  (Section 19 / Section 6.1), deferred rather than rejected outright.
- **Ownable** — rejected with no planned future reconsideration; the role
  hierarchy makes this a poor fit regardless of project scale.

## Consequences
- The contract's storage layout (mapping of election structs) must be
  designed up front to support efficient lookups without unbounded loops
  (Section 5's gas-minimization guidance applies directly).
- All future contract versions are new deployments, not migrations; the
  backend's Blockchain Service Layer (ADR-004) must resolve contract
  address/ABI per election to support this.
- Role grants/revocations are themselves privileged on-chain transactions,
  emitting events that feed the audit logging strategy (Section 17).
