# contracts/

Solidity source files live here. Empty until Phase 2 (Smart Contracts), per
the development roadmap (architecture Section 21).

Per ADR-005, the planned contracts are:

- `VoterRegistry.sol` — tracks per-address, per-election voter eligibility.
- `Election.sol` — candidate management, vote casting, tallying, and the
  state-machine-driven lifecycle (Draft → ... → Archived, Section 16),
  including the explicit `finalizeElection()` transaction (ADR-006).
- Access control via OpenZeppelin's `AccessControl` (not `Ownable`),
  inherited by both contracts above — see ADR-005.

No contracts will be implemented here until Phase 1 (this scaffold) is
reviewed and approved.
