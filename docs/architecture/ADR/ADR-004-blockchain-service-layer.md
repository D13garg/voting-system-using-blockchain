# ADR-004: Centralized Blockchain Service Layer

## Status
Accepted — Architecture v3.0

## Context
Multiple backend domain modules (Election, Voting, Admin) and the worker
process all need to interact with the blockchain — reading contract state,
estimating gas, subscribing to events, normalizing RPC errors. If each
module implements this independently, provider failover, retry logic, ABI
versioning, and error handling risk being solved differently (or
incorrectly) in multiple places.

## Decision
Introduce a single `blockchain` module that is the **only** code in the
entire backend/worker codebase permitted to import a contract ABI or hold a
provider/signer instance. It owns:
- Provider creation (Viem client, Alchemy primary / Infura fallback)
- Signer management (a dedicated low-privilege key, distinct from any
  deployer or admin key)
- Contract initialization, including ABI-version resolution per election
  (supporting ADR-005's versioning strategy)
- Transaction submission helpers and confirmation waiting
- Event subscription management
- Gas estimation helpers
- Normalized error handling and retry/backoff for transient RPC failures
  (never retrying deterministic contract reverts)

Every other module and the worker call into this layer rather than
constructing their own provider or contract instance.

## Rationale
- **Single point of correctness**: "how do we talk to the chain" becomes a
  solved problem the rest of the backend depends on, rather than a pattern
  re-implemented (and potentially re-broken) in Election, Voting, Admin, and
  the worker independently.
- **Security review surface**: reviewing how the backend interacts with the
  chain — a security-sensitive boundary — only requires examining one
  module, not auditing every domain module for correct key handling and RPC
  error behavior.
- **Forward compatibility with contract versioning**: because ABI/address
  resolution lives in one place, supporting a future V2 contract (ADR
  pending, see Section 6.1) is a configuration change in this module, not a
  change scattered across every module that happens to read contract state.

## Alternatives Considered
**Each domain module manages its own contract instance** — Marginally less
indirection for a very small project. Rejected because it directly
contradicts the modularity/reuse goal (Section 23): a future project reusing
the `blockchain` module wholesale is only possible if no domain-specific
code leaked into it, which requires this boundary to be enforced from the
start, not refactored in later.

## Consequences
- Every domain module's tests that touch blockchain data must mock the
  `blockchain` module's interface, not raw Viem/ethers calls — this is a
  deliberate and acceptable testing constraint, not a workaround.
- Any future contract version (V2) is integrated by extending this module's
  ABI-version map, not by modifying Election/Voting/Admin module internals.
