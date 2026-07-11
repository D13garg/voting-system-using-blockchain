# Decentralized Voting System — Architecture Design Document

**Version:** 3.0 (Final architecture before implementation)
**Status:** Design phase — approved; implementation in progress
**Purpose:** Flagship portfolio project covering blockchain fundamentals with a
production-inspired, reusable, domain-driven backend
**Author role:** Senior Blockchain Architect / Full-Stack Engineer / Security
Engineer (design pass)

> This is the project's single source of truth. Implementation must follow
> this document strictly (see project development rules). Any discovered
> architectural problem must be raised and approved before this document is
> amended — see `docs/architecture/ADR/` for the decision trail and
> `docs/architecture/decisions-log.md` for a summary of items confirmed at
> implementation kickoff.

---

## Changelog from v2.0 → v3.0

- **Backend organization:** Reorganized from generic layers (routes/services)
  into domain-driven modules (Auth, Election, Candidate, Voting, Blockchain,
  Wallet, Analytics, Notifications, Admin, IPFS) — Section 7.
- **New Blockchain Service Layer:** A single module now owns every
  contract/provider/signer interaction; no other backend code talks to the
  chain directly — Section 7.2.
- **Read/write architecture made explicit:** Section 3 now has a dedicated
  subsection separating the write path (wallet → contract → chain) from the
  read path (chain events → listener → MongoDB → frontend), with sequence
  diagrams.
- **New Section 8 — Background Worker Architecture:** Event listening,
  analytics, and notifications moved out of the Express process into
  dedicated worker process(es).
- **Expanded role hierarchy:** Section 13 (was 11) now has five tiers:
  Guest → Wallet User → Verified Voter → Election Administrator → System
  Administrator.
- **New Section 11 — On-Chain vs. Off-Chain Data Reference:** A single
  authoritative table for where every entity lives.
- **New subsection in Section 6 — Smart Contract Versioning Strategy:**
  documents a future upgrade path without implementing it now.
- **New Section 16 — Election State Machine:** replaces the informal
  lifecycle description with formal states/transitions.
- **New Section 17 — Logging and Audit Strategy.**
- **New Section 18 — Configuration Management.**
- Folder structure, technology stack, and roadmap updated to reflect domain
  modules, the Blockchain Service Layer, and the worker process.
- All other sections (functional/non-functional requirements, frontend
  architecture, blockchain design rationale, future enhancements) are
  unchanged from v2 unless referenced above.

---

## 1. Functional Requirements

### Core Features
- Voter wallet connection (MetaMask / WalletConnect)
- Voter registration (whitelist-based, admin-approved)
- Election creation by admin (title, description, candidates, start/end time)
- Casting a single vote per registered voter per election
- On-chain vote tallying, publicly verifiable
- Real-time results display after election ends (or live, if design allows)
- Election lifecycle states: see Section 16's formal state machine
- Event-driven UI updates (vote cast, election created, election ended)
- Admin dashboard to manage elections and view registrations
- Voter dashboard to view eligible elections, vote status, and history

### Nice-to-Have Features
- Multiple concurrent elections
- Candidate metadata (photos, bios) stored off-chain (IPFS)
- Email/notification on election start/end (off-chain backend)
- Pagination/search/filtering on past elections
- Voter receipt (transaction hash) downloadable as proof of participation
- Light/dark themed responsive UI

### Stretch Goals
- Delegated voting (proxy voting)
- On-chain governance for protocol parameters (e.g., voting duration limits)
- Multi-signature admin actions (e.g., 2-of-3 admins required to create an
  election)
- Analytics dashboard (turnout %, time-series participation)
- Anonymous voting via commit-reveal scheme (precursor to ZK)

---

## 2. Non-Functional Requirements

**Security** — This is the highest priority. The contract is the source of
truth; any compromise (double voting, unauthorized election creation,
reentrancy) undermines the entire premise of "tamper-resistant." Addressed at
the contract layer (access control, checks-effects-interactions), the backend
layer (input validation, rate limiting), and the wallet layer (signature
verification, replay protection).

**Scalability** — At portfolio scale, scalability is about gas efficiency and
read-path performance, not throughput. Strategy: minimize on-chain storage,
use events + indexing for read-heavy operations instead of expensive on-chain
loops, keep the backend stateless so it can be horizontally scaled, and
isolate event-driven workloads into worker processes (Section 8).

**Reliability** — The blockchain guarantees vote durability once confirmed.
Reliability concerns shift to RPC provider uptime (mitigated via a managed
provider with fallback), the worker staying in sync with chain state
(checkpointing, restart-safety), and the frontend gracefully handling
RPC/network failures.

**Performance** — On-chain reads (loops over voters/candidates) are slow and
gas-expensive as transactions; done as free view calls or via an off-chain
indexer/cache instead. Frontend performance depends on caching contract reads
and refetching only on relevant events. The explicit read/write separation
(Section 3) is the primary performance lever.

**Maintainability** — Achieved through modular smart contracts, strict
TypeScript on frontend/backend, ABI-driven contract interaction (typed
bindings via TypeChain), domain-driven backend modules (Section 7), a single
Blockchain Service Layer, and clear separation between on-chain logic and
off-chain orchestration.

**Cost** — Real-money cost is gas fees (testnet gas is free; no mainnet
deployment) and infrastructure (RPC provider, hosting, IPFS pinning).
Strategy: Sepolia testnet only, free-tier RPC providers, free-tier hosting,
free IPFS pinning.

**Deployment Strategy** — Local (Hardhat local node), Testnet (Sepolia,
public/verifiable), "Production" (a polished, publicly hosted version still
pointing at Sepolia).

---

## 3. High-Level Architecture

```
                            ┌─────────────────────────┐
                            │        Voter/Admin       │
                            │   (Browser + Wallet)     │
                            └────────────┬─────────────┘
                                         │ HTTPS
                                         ▼
                  ┌──────────────────────────────────────────┐
                  │              Frontend (SPA)               │
                  │  React + Wagmi/Viem + RainbowKit/Web3Modal│
                  └───────────┬───────────────────┬────────────┘
                              │                   │
              REST/JSON-RPC   │                   │  Web3 calls (read/write)
                              ▼                   ▼
                  ┌─────────────────────┐   ┌───────────────────────────┐
                  │   Backend API       │   │   Blockchain Node (RPC)   │
                  │  Node.js / Express  │   │  Alchemy / Infura → Sepolia│
                  │  (domain modules,   │   └─────────────┬─────────────┘
                  │   Section 7)        │                 │
                  └──────────┬──────────┘                 ▼
                             │              ┌───────────────────────────┐
                             │              │   Smart Contracts (EVM)   │
                             │              │  Election Factory         │
                             │              │  Election Contract        │
                             │              │  VoterRegistry            │
                             │              └─────────────┬─────────────┘
                             ▼                            │ emits events
                  ┌─────────────────────┐                 │
                  │  Database (MongoDB) │◄────────────────┘
                  │  - Cached on-chain  │   (via Background Worker,
                  │    events (worker)  │    not the API process — Section 8)
                  │  - Off-chain metadata│
                  │  - Analytics rollups │
                  └─────────────────────┘
                             ▲
                             │ pins / fetches
                             ▼
                  ┌─────────────────────┐
                  │  IPFS (candidate     │
                  │  images, manifests)  │
                  └─────────────────────┘

        ┌─────────────────────┐        ┌─────────────────────┐
        │   Hosting (Vercel)   │        │  Monitoring (Sentry, │
        │   Frontend + Backend │        │  Tenderly, Etherscan)│
        └─────────────────────┘        └─────────────────────┘
```

**Component roles:**
- **Frontend:** All vote-casting transactions are signed and sent directly
  from the user's wallet to the blockchain — the backend never holds custody
  of votes or private keys.
- **Backend API:** Organized into domain modules (Section 7), exposes REST
  endpoints, talks to the chain only through the Blockchain Service Layer
  (Section 7.2), never runs the event listener itself.
- **Background Worker:** A separate Node.js process responsible for chain
  event listening, MongoDB writes, analytics generation, and notification
  dispatch (Section 8).
- **Blockchain:** Source of truth for votes, voter registration status, and
  election state.
- **Database (MongoDB):** A read-optimized mirror of on-chain events plus
  genuinely off-chain data.
- **Storage (IPFS):** Immutable storage for candidate images/metadata,
  referenced on-chain only by hash (CID).
- **Hosting:** Frontend, backend API, and worker deployed as separate
  processes/services so each can scale or fail independently.
- **Monitoring:** Sentry for app errors, Tenderly for contract-level
  transaction tracing/alerts, Etherscan for public on-chain verification.

### 3.1 Read/Write Architecture (explicit separation)

**Write path (always):** `Wallet → Smart Contract → Blockchain`. Every
state-changing action is a transaction signed directly by a wallet. The
backend never sits in this path as a submitter.

**Read path (primarily):** `Blockchain Events → Background Worker (Event
Listener) → MongoDB → Frontend (via Backend API)`. Almost all reads hit
MongoDB through the backend API, not the chain directly.

**Why this separation matters:**
- Fewer RPC calls
- Better performance (MongoDB reads are milliseconds; RPC reads depend on
  provider latency and free-tier rate limits)
- Better UX (pages render from cached, indexed data immediately)
- Blockchain remains the source of truth — every MongoDB document is derived
  from a chain event with a recorded `txHash`/`blockNumber`, re-verifiable at
  any time.

**Sequence diagram — Write path (vote casting) and downstream read-path
propagation:**

```
Voter Wallet    Frontend       Blockchain      Background Worker     MongoDB        Backend API     Other Frontends
     │              │               │                  │                │               │                  │
     │ sign vote()  │               │                  │                │               │                  │
     │─────────────►│               │                  │                │               │                  │
     │              │ submit tx     │                  │                │               │                  │
     │              │──────────────►│                  │                │               │                  │
     │              │               │ mine & emit      │                │               │                  │
     │              │               │ VoteCast event   │                │               │                  │
     │              │               │─────────────────►│                │               │                  │
     │              │◄─tx receipt───┤                  │ upsert event   │               │                  │
     │              │ (own UI       │                  │───────────────►│               │                  │
     │              │  updates now) │                  │                │ change stream │                  │
     │              │               │                  │                │──────────────►│ update tally     │
     │              │               │                  │                │               │ cache, expose via│
     │              │               │                  │                │               │ GET /results     │
     │              │               │                  │                │               │─────────────────►│
```

**Sequence diagram — Write path (admin approves registration):**

```
Admin (Frontend)   Blockchain         Background Worker      MongoDB           Backend API      Voter's Frontend
      │                  │                    │                  │                  │                  │
      │ registerVoter()  │                    │                  │                  │                  │
      │ (admin wallet)   │                    │                  │                  │                  │
      │─────────────────►│                    │                  │                  │                  │
      │                  │ VoterRegistered    │                  │                  │                  │
      │                  │───────────────────►│ upsert + mark    │                  │                  │
      │                  │                    │ request approved │                  │                  │
      │                  │                    │─────────────────►│                  │                  │
      │                  │                    │                  │  voter polls /eligibility           │
      │                  │                    │                  │◄─────────────────│◄─────────────────│
      │                  │                    │                  │  returns "eligible"                 │
      │                  │                    │                  │─────────────────►│─────────────────►│
```

In both diagrams, the backend never initiates a state-changing transaction on
a user's behalf — only the actual wallet does. The worker's only write path
into MongoDB is triggered by confirmed on-chain events.

---

## 4. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend Framework | React + TypeScript (Vite) | Industry standard, fast dev server, strong typing reduces Web3 integration bugs |
| Web3 Library | Viem + Wagmi | Modern, type-safe, tree-shakeable; current best practice for React dApps |
| Wallet Connection | RainbowKit (built on Wagmi) | Multi-wallet UX with minimal boilerplate |
| Styling | Tailwind CSS | Fast iteration, consistent design tokens |
| Smart Contract Language | Solidity ^0.8.x | Native EVM language; built-in overflow checks since 0.8 |
| Contract Framework | Hardhat | Best-in-class local dev node, testing, scripting, verified-deploy tooling |
| Contract Testing | Hardhat + Chai + Mocha, Solidity coverage plugin | Coverage plugin proves test completeness on a security-sensitive contract |
| Typed Contract Bindings | TypeChain | Auto-generates TypeScript types from ABI |
| Blockchain Network | Ethereum (Sepolia Testnet) | See Section 5 |
| RPC Provider | Alchemy (Infura fallback) | Reliable free tier, webhook support |
| Backend Runtime | Node.js + Express (TypeScript) | Matches frontend language; organized into domain modules (Section 7) |
| Blockchain Interaction Library | Viem (server-side) | Same library as frontend, used inside the Blockchain Service Layer |
| Worker Process Framework | Node.js (separate entrypoint) + BullMQ | Event-processing/analytics/notifications run outside the Express request cycle, with retries/backoff |
| Queue Backing Store | Redis | BullMQ's required backing store; also a lightweight cache if needed |
| Authentication | Sign-In With Ethereum (SIWE) | Wallet-native auth, ties identity to the same key used for voting |
| Database | MongoDB | See ADR-001 |
| ODM | Mongoose | Schema validation on top of MongoDB's flexibility |
| Off-chain File Storage | IPFS via web3.storage or Pinata | Decentralized storage for candidate images/bios |
| Testing (Frontend) | Vitest + React Testing Library | Fast, Vite-native test runner |
| Testing (Backend) | Vitest/Jest + mongodb-memory-server | In-memory MongoDB for fast, isolated backend tests |
| Testing (Contracts) | Hardhat test suite + Slither | Slither catches common vulnerability patterns automatically |
| CI/CD | GitHub Actions | Free for public repos; runs contract tests + linting + builds + Slither on every PR |
| Containerization | Docker (API + worker + MongoDB + Redis via docker-compose) | Reproducible local dev for the multi-process backend |
| Hosting (Frontend) | Vercel | Zero-config React deploys, free tier |
| Hosting (Backend API + Worker) | Render or Railway (two services) | Both support running multiple services from one repo |
| Monitoring | Sentry + Tenderly + Pino | Tenderly catches anomalous transactions; Pino gives structured JSON logs |
| API Documentation | OpenAPI/Swagger | Documented, browsable API surface |
| Package Manager | pnpm | Faster installs, disk-efficient |

---

## 5. Blockchain Design

**Why Ethereum?** Largest developer ecosystem, most mature tooling (Hardhat,
OpenZeppelin, Etherscan, RainbowKit), deepest security research/audit
precedent for voting-style contracts. Ethereum/EVM skills are the most
broadly recognized by employers.

**Why not Hyperledger?** Permissioned, no native gas model, no public
verifiability by third parties, different programming model (chaincode in
Go/Java). Public-chain transparency aligns with "voting should be
independently verifiable by anyone."

**Why Sepolia Testnet?** Current recommended Ethereum testnet (Goerli
deprecated), reliable faucets, supported by all major RPC providers and
Etherscan, lets the project be publicly deployed/verified/demoed for free.

**Should votes be stored fully on-chain?** Yes, but minimally: voter address
→ candidate ID, plus an incremented tally counter. What is not stored
on-chain: candidate bios/photos, election descriptions, notification
preferences.

**Should users register on-chain or off-chain?** Hybrid: the authoritative
"is this address allowed to vote" flag lives on-chain (`VoterRegistry`
mapping), set by an admin transaction. The registration request/approval
workflow happens off-chain, with only the final approval written on-chain.

**What should remain off-chain?** Candidate bios/photos/descriptions (→ IPFS
+ DB cache), election long-form text, notification preferences, analytics/
dashboards (derived, not recomputed from chain per request), admin UI
session/auth state.

**How should gas fees be minimized?**
- Mappings instead of arrays for lookups (O(1) vs O(n))
- Avoid on-chain loops over unbounded voter lists; let the worker index
  events instead
- Pack structs efficiently
- Emit events rather than storing redundant historical data
- Use `calldata` instead of `memory` for read-only parameters
- Batch admin operations where feasible

---

## 6. Smart Contract Architecture

*(Conceptual design — see ADR-005 for the final decisions on contract
structure, upgradeability, and access control.)*

**Contracts:**

**`VoterRegistry`** — tracks which addresses are approved to vote, globally
or per-election. Storage: `mapping(address => bool) isRegistered`,
optionally `mapping(uint256 => mapping(address => bool))
isRegisteredForElection`. Events: `VoterRegistered(address voter)`,
`VoterRemoved(address voter)`. Modifiers: `onlyAdmin`. Access control: only
addresses with `ADMIN_ROLE` can register/remove voters.

**`ElectionFactory`** *(or embedded logic in a single contract — see
ADR-005, which selects the single-contract approach)* — deploys/tracks
elections. Storage: `mapping(uint256 => Election) elections`,
`uint256 electionCount`. Struct: `Election { uint256 id; string title;
uint256 startTime; uint256 endTime; bool finalized; address creator; }`.
Events: `ElectionCreated(uint256 id, string title, uint256 startTime,
uint256 endTime)`. Modifiers: `onlyAdmin`, `onlyDuringRegistrationWindow`.

> Design note: a factory pattern gives stronger isolation at the cost of
> higher per-election deployment gas. A single-contract design is cheaper
> and simpler for this project's scope and is the **recommended default**
> — confirmed in ADR-005. Factory pattern remains a stretch-goal upgrade.

**`Election`** (logic embedded in the main contract per ADR-005) —
candidate management, vote casting, tallying. Storage:
`mapping(uint256 => Candidate) candidates`, `mapping(address => bool)
hasVoted`, `mapping(uint256 => uint256) voteCounts`. Struct:
`Candidate { uint256 id; string name; string metadataURI; uint256
voteCount; }`. Events: `VoteCast(uint256 electionId, address voter,
uint256 candidateId)`, `ElectionEnded(uint256 electionId)`, and
`ElectionFinalized(uint256 electionId)` per ADR-006. Modifiers:
`onlyDuringActiveElection`, `onlyRegisteredVoter`, `hasNotVoted`. Access
control: vote-casting open to any registered voter during the active
window; candidate creation and lifecycle transitions are admin-only,
mirroring the state machine (Section 16).

**`AccessControl`** (OpenZeppelin's `AccessControl`, per ADR-005) — shared
role definitions (`SYSTEM_ADMINISTRATOR_ROLE`, `ELECTION_ADMINISTRATOR_ROLE`)
inherited by the contracts above.

**Upgradeable or not?** Not upgradeable for V1 — confirmed in ADR-005. See
Section 6.1.

**Ownership model:** Role-based access control (OpenZeppelin
`AccessControl`) rather than single-owner `Ownable` — confirmed in ADR-005.

**Emergency pause:** OpenZeppelin's `Pausable` mixin on vote-casting and
election-creation functions, controlled by `SYSTEM_ADMINISTRATOR_ROLE`.

### 6.1 Smart Contract Versioning Strategy (documentation only — not implemented in v1)

**Why Version 1 will remain immutable:** Upgradeability (proxy patterns)
introduces its own security surface — storage collision bugs, malicious
upgrade risk, harder audit story — disproportionate to this project's goals.
Immutability also reinforces the "tamper-resistant" narrative: once deployed,
nobody (including the developer) can silently change the rules mid-election.

**How future contract versions could be introduced:** Versioned deployment,
not in-place upgrade. `ElectionV2`, `VoterRegistryV2`, etc. deployed as
entirely new contracts at new addresses. A registry tracks which contract
version backs which election. Only new elections use V2; elections already
running on V1 finish their lifecycle on V1 unchanged.

**Possible migration approaches:**
- **No migration (preferred):** old elections live out their lifecycle on
  the old contract — consistent with treating each election's contract as
  an immutable historical record.
- **Data-only migration:** if needed, the worker/analytics layer can read
  both versions' events and merge them off-chain.
- **Full proxy-based upgradeability:** deferred to Future Enhancements
  (Section 22) if a later scope genuinely requires in-place upgrades.

**Compatibility considerations:** The Blockchain Service Layer (Section 7.2)
accepts a contract version/address per election rather than hardcoding a
single ABI. Event schemas distinguish V1 vs V2 events in the worker's
listener and analytics rollups.

---

## 7. Backend Architecture — Domain-Driven Modules

**Should we even have a backend?** Yes — a complete, production-inspired
backend, not a thin convenience layer. It remains non-authoritative: the
contract alone is sufficient to run an election; the backend never asserts
state the chain hasn't already confirmed.

### 7.1 Domain-Driven Module Organization

Organized around business domains, each owning its own routes, service
logic, and Mongoose models:

- **Auth** — SIWE-based wallet authentication, session issuance
- **Election** — election metadata, draft management, lifecycle queries
- **Candidate** — candidate metadata, bios, IPFS CID references
- **Voting** — indexed vote events, tally queries, "has voted" checks
- **Blockchain** — the dedicated service layer (Section 7.2); the only
  module permitted to import a contract ABI or hold a provider/signer
- **Wallet** — address validation, ENS resolution, wallet-centric helpers
- **Analytics** — pre-aggregated turnout/participation rollups
- **Notifications** — email/webhook dispatch on lifecycle events
- **Admin** — role management, registration approval workflow, admin queries
- **IPFS** — pinning and retrieval of candidate images/metadata

**Shared infrastructure (NOT domain modules):** `middleware/` (error
handling, rate limiting, request logging), `config/` (Section 18),
`utils/` (pure helpers), `db/` (Mongoose connection bootstrapping — not
schemas, which live with their owning domain module).

**Why this structure improves scalability, maintainability, testing, and
reuse:**
- **Scalability:** each domain module has a narrow surface area; new logic
  has an obvious home.
- **Maintainability:** a developer fixing a registration-approval bug only
  needs to understand Admin and Election, not trace logic across unrelated
  files.
- **Testing:** each module unit-tested in isolation with mocked dependencies.
- **Future reuse:** a future certificate-verification system reuses Auth,
  Blockchain, Notifications, Analytics, and IPFS almost unchanged, replacing
  Election/Candidate/Voting with Certificate/Issuer/Verification — every
  module follows the same internal shape (routes + service + model).

### 7.2 Blockchain Service Layer (dedicated module)

No other backend or worker code communicates with the smart contract
directly. Every contract interaction goes through this module:

- **Provider creation** — Viem public client against configured RPC URL
  (Alchemy primary, Infura fallback), retry/backoff on connection failure
- **Signer management** — a dedicated low-privilege key for rare
  backend-initiated reads, never the same key as any admin/deployer key
- **Smart contract initialization** — loads ABI + address per
  network/version, exposes typed contract instances
- **Transaction submission helpers** — proper nonce handling for the rare
  backend-initiated transaction
- **Waiting for confirmations** — `waitForReceipt(txHash)` used by the
  worker
- **Event subscriptions** — the single place opening subscriptions/polling
  against contract events
- **Gas estimation** — exposed for frontend "prepare transaction" UX
- **Error handling and retry logic** — normalizes RPC errors into a
  consistent internal error type; retries transient RPC failures (never
  deterministic contract reverts)

**Why centralize this:** A single module makes "how do we talk to the
chain" a solved problem the rest of the backend depends on, supporting
Maintainability and Reliability (Section 2).

```
Election Module ─┐
Voting Module ────┼──► Blockchain Service Layer ──► Viem Provider ──► RPC ──► Sepolia
Admin Module ─────┤         (single chokepoint)
Worker Process ───┘
```

### 7.3 Conceptual Endpoints (by domain module)

- `POST /auth/siwe` — verify wallet signature, issue session
- `GET /elections` — list elections (merged on-chain status + off-chain metadata)
- `POST /elections/draft` — admin saves draft metadata before on-chain creation
- `GET /elections/:id/results` — cached/indexed tally
- `POST /voters/register-request` — voter submits a registration request
- `GET /admin/registration-requests` — pending requests
- `POST /admin/registration-requests/:id/approve` — review step; admin's wallet signs the actual on-chain transaction
- `GET /analytics/:electionId` — turnout and participation stats
- `GET /candidates/:electionId` — candidate list with IPFS-resolved images
- `GET /api-docs` — interactive OpenAPI/Swagger documentation

---

## 8. Background Worker Architecture

Long-running, asynchronous, event-reactive work is separated from the
Express API process into one or more worker processes (see ADR-002).

**What runs in the worker (not the API):**
- Blockchain event listening (via the Blockchain Service Layer)
- Writing indexed events to MongoDB
- Analytics rollup generation (triggered by direct enqueue from the
  worker's event handlers as each relevant write happens — see
  [ADR-007](./ADR/ADR-007-analytics-trigger-direct-enqueue.md); not
  MongoDB Change Streams, which the original design called for but which
  require a replica-set MongoDB this project's standalone `docker-compose.yml`
  instance doesn't provide)
- Notification dispatch
- Cache updates
- Background synchronization/reconciliation (periodic re-check of the
  worker's checkpoint against the chain's current block, to self-heal after
  an outage)

**Why this scales better than putting everything in the API server:**
- **Independent scaling** — unrelated workloads, unrelated scaling triggers
- **Failure isolation** — RPC outage stalling the listener doesn't stall the
  API; a traffic spike doesn't starve the listener
- **Single writer eliminates races** — exactly one writer of chain-derived
  data; avoids duplicated RPC subscriptions and write races
- **Standard deployment pattern** — Render/Railway support a web service and
  worker service from one repo with different start commands

**Communication flow:**

```
                       emits events
Blockchain ───────────────────────────────► Worker Process
                                                 │
                                                 │ writes indexed events,
                                                 │ runs analytics rollups,
                                                 │ dispatches notifications
                                                 ▼
                                              MongoDB
                                                 ▲
                                                 │ reads only (never writes
                                                 │ chain-derived collections)
                                                 │
Express API ◄───────────────────────────────────┘
     ▲
     │ HTTP
     │
  Frontend
```

The API process and worker process share the same Mongoose models, so there
is no schema drift between writer and reader.

**Job queue (BullMQ + Redis):** notification dispatch and analytics
recomputation are queued jobs, not direct function calls inside the event
handler — a slow downstream service retries automatically (with backoff)
instead of blocking the listener's processing of the next event.

---

## 9. Frontend Architecture

**Pages:** Landing/Home (active elections), Election Detail
(candidates/voting/results), Voter Dashboard, Admin Dashboard, Create
Election (admin form), Registration Requests (admin review queue),
Results/Archive.

**Components (representative):** `WalletConnectButton`,
`WalletStatusBadge`, `ElectionCard`/`ElectionList`/`ElectionTimer`,
`CandidateCard`/`CandidateList`/`VoteButton`, `ResultsChart`,
`TransactionStatusToast`, `AdminElectionForm`, `AdminCandidateInput`,
`RegistrationRequestRow`, `ApproveRejectButtons`, `RoleGuard`.

**State Management:** Wagmi's React-Query-based caching for on-chain reads;
React Query for backend API calls; lightweight local/context state (Zustand
or React context) only for pure UI state.

**Wallet Connection Flow:** Connect → approve in wallet → frontend reads
address/chain via Wagmi → checks Sepolia, prompts switch if needed → (for
admin/voter features) SIWE signature to authenticate with backend.

**Voting Flow:** Open election detail (read via backend API, sourced from
MongoDB) → check `hasVoted`/`isRegistered` → select candidate → `vote()` via
Wagmi `writeContract` (the write path, straight to chain, never through the
backend) → pending state → on confirmation, UI updates immediately from the
receipt; backend's view converges shortly after via the worker → on failure,
surface the revert reason clearly.

**Admin Dashboard:** Lifecycle controls gated by the state machine (Section
16); voter registration approval queue; live tally view; role management
(System Administrator only).

**Routing:** React Router, `RoleGuard` wrapper redirecting based on an
on-chain role check (the contract remains authoritative for roles even
though the backend mirrors them for fast checks).

**Validation:** Client-side for UX, re-validated by the contract (final
authority).

**Error Handling:** Centralized mapping from contract revert reasons / RPC
errors into human-readable toast messages.

---

## 10. Database Design

**Which database? Why?** MongoDB — see ADR-001 for the full reasoning.

**Document Model:**

```
ElectionMetadata (collection)
{
  _id,
  onchainElectionId   (indexed, unique),
  title,
  description,
  state                (mirrors the state machine in Section 16),
  createdBy            (wallet address),
  createdAt
}
// Candidates are NOT embedded here — see CandidateProfile below. Election
// metadata only carries election-level fields; per-candidate data lives in
// its own collection.

CandidateProfile (collection)                 ◄── REFERENCED, not embedded
// As-built, Phase 5 (Candidate module). Supersedes this section's earlier
// sketch of an embedded `ElectionMetadata.candidates[]` array — see the
// "Design note" below the schema for the reasoning.
{
  _id,
  electionId           (compound unique index w/ candidateId),
  candidateId,
  bio,
  updatedBy            (wallet address of last editor),
  createdAt,
  updatedAt
}
// Candidate `name` and `metadataURI` are on-chain-authoritative and are NOT
// mirrored into this document at all (unlike the earlier sketch, which
// assumed a `name` mirror) — they're read from IndexedCandidate below
// (added Phase 7 - see that collection's own entry) rather than a live
// getCandidate() call, for the module's main listing endpoint. Only `bio`
// is off-chain-authoritative here, since it has no on-chain representation
// at all.
//
// Design note — why referenced, not embedded: this section originally
// specified candidates as an array embedded inside `ElectionMetadata`,
// reasoning that they're always read together with their election and
// never queried independently. The shipped design instead uses a separate,
// referenced collection, for two reasons found once real implementation
// started: (1) `bio` and `name`/`metadataURI` have different authority and
// different update cadences — `bio` is freely editable pre-vote-start via
// its own endpoint, while `name`/`metadataURI` only ever change via an
// on-chain `CandidateAdded` event — collapsing them into one embedded
// document blurred that distinction; (2) a separate collection matches the
// shape the event-indexing worker (Section 8/17) already uses for every
// other indexed entity. Reconciled and confirmed as the intended shape
// going forward — not superseded again without a fresh ADR.

IndexedVoteEvent (collection)                 ◄── REFERENCED, not embedded
{
  _id,
  onchainElectionId   (indexed),
  voterAddress         (indexed),
  candidateId,
  txHash               (unique index — idempotency key),
  logIndex,
  blockNumber,
  timestamp
}
// Rationale for a separate collection: this grows unboundedly per election and is
// queried independently (tally aggregation, turnout-over-time) — embedding it inside
// ElectionMetadata would blow past MongoDB's 16MB document size limit for any
// election with meaningful turnout.

IndexedElection (collection)                  ◄── worker-maintained mirror
// Added Phase 7 (decision (a): read-migration pass). Populated by the
// worker from ElectionCreated/CandidateAdded/ElectionFinalized -
// election.service.ts's listElections/getElectionById read this instead
// of a live per-request chain call. Dual-write: these 3 events ALSO
// still land in the generic IndexedChainEvent log below, unchanged.
{
  _id,
  electionId            (unique index),
  title, startTime, endTime, creator   (from ElectionCreated; optional -
                                         see next line),
  finalized, finalizedBy               (from ElectionFinalized),
  candidateIds: [number]                (from CandidateAdded, via $addToSet)
}
// Fields other than electionId/finalized/candidateIds are optional: this
// collection's writers (ElectionCreated, CandidateAdded) run on
// independent per-event-type checkpoints and can be processed out of
// order relative to each other, so a document can briefly exist with
// only candidateIds populated. Callers treat a document lacking `title`
// as "not yet fully synced". Right after a fresh link
// (PATCH .../link-onchain), if the mirror hasn't caught up yet within a
// short grace window, reads return 503 ELECTION_SYNC_PENDING (retry-safe)
// rather than being conflated with the genuine 404 ELECTION_STATE_MISMATCH
// case (mirror never catches up - real chain-state corruption, e.g. a
// local Hardhat reset).

IndexedCandidate (collection)                 ◄── worker-maintained mirror
// Added Phase 7. Candidate.name/metadataURI are on-chain-authoritative
// and were never mirrored anywhere until this pass - candidate.service.ts's
// listCandidates reads name/metadataURI from here (merged with
// CandidateProfile's bio) instead of a live getCandidate() call per
// candidate. Referenced, not embedded in IndexedElection, for the same
// reasoning as CandidateProfile above (identity data and bio data have
// different write paths and different authorities).
{
  _id,
  electionId, candidateId   (compound unique index),
  name, metadataURI          (from CandidateAdded)
}
// Write-once per (electionId, candidateId) - CandidateAdded fires at
// most once per candidate (no removal/edit function exists on-chain), so
// unlike IndexedVoterRegistration below, no event-ordering complexity
// applies here.
//
// setCandidateProfile's own existence check (the PUT endpoint) is
// DELIBERATELY NOT migrated to read this collection - it stays a live
// getCandidate() call, since an admin plausibly adds a candidate
// on-chain and sets its bio in the same sitting, and there's no
// backend-tracked "just linked" timestamp here (unlike IndexedElection's
// grace-window mechanism above) to distinguish real absence from mirror
// lag.

IndexedVoterRegistration (collection)         ◄── worker-maintained mirror
// Added Phase 7. Populated by the worker from VoterRegistered/
// VoterRemoved - admin.service.ts's every read sources onChainConfirmed
// from here instead of a live isRegisteredForElection() call.
{
  _id,
  electionId, voterAddress   (compound unique index; voterAddress always
                               lowercased - a live chain call is
                               case-insensitive via Solidity's `address`
                               type, a Mongo string match is not, and
                               nothing else in this codebase normalizes
                               wallet-address casing),
  registered                  (boolean),
  lastEventBlockNumber, lastEventLogIndex   (chain-order tiebreakers, NOT
                                              a processing-order log)
}
// Harder than IndexedElection/IndexedCandidate: a voter can be
// registered, removed, and re-registered repeatedly (VoterRegistry.sol's
// AlreadyRegistered/NotCurrentlyRegistered errors confirm this), and
// VoterRegistered/VoterRemoved sync on INDEPENDENT checkpoints, so they
// can be processed out of order RELATIVE TO EACH OTHER (e.g. a later
// VoterRemoved processed before an earlier VoterRegistered, if that
// checkpoint lags). Every write is therefore conditional on
// (lastEventBlockNumber, lastEventLogIndex) being newer than what's
// already stored - "last wins by chain order", not by processing order.
// A missing document here is NOT an error case (unlike IndexedElection's
// SYNC_PENDING/STATE_MISMATCH split) - it's the correct default answer,
// since VoterRegistry.sol itself defaults every voter to unregistered.

RegistrationRequest (collection)
{
  _id,
  walletAddress        (indexed),
  onchainElectionId    (indexed),
  status               ("pending" | "approved" | "rejected"),
  requestedAt,
  reviewedBy,
  reviewedAt
}

AdminUser (collection)
{
  _id,
  walletAddress         (unique index),
  role                  ("system_administrator" | "election_administrator"),
  addedAt
}

AnalyticsRollup (collection)
{
  _id,
  onchainElectionId    (unique index),
  totalVotes,
  turnoutPercent,
  votesByCandidate: { [candidateId]: count },
  participationOverTime: [ { timestamp, cumulativeVotes } ],
  lastUpdatedFromBlock
}
// Pre-aggregated by the Analytics module reacting to Change Stream events,
// running inside the worker process (Section 8), not the API.
```

**Indexes:**
- `IndexedVoteEvent`: compound `{ onchainElectionId: 1, candidateId: 1 }`;
  unique `{ txHash: 1, logIndex: 1 }`
- `ElectionMetadata`: unique `onchainElectionId`
- `CandidateProfile`: unique compound `{ electionId: 1, candidateId: 1 }`
- `IndexedElection`: unique `electionId`
- `IndexedCandidate`: unique compound `{ electionId: 1, candidateId: 1 }`
- `IndexedVoterRegistration`: unique compound `{ electionId: 1, voterAddress: 1 }`
- `RegistrationRequest`: compound `{ walletAddress: 1, status: 1 }`
- `AdminUser`: unique `walletAddress`
- `AnalyticsRollup`: unique `onchainElectionId`

---

## 11. On-Chain vs. Off-Chain Data Reference (Authoritative)

This table is the single source of truth for where every piece of data
lives. Check here before deciding where to read or write any field.

| Data | On-Chain (authoritative) | MongoDB | IPFS | Cached | Derived |
|---|---|---|---|---|---|
| Voter eligibility flag | **Yes** | Mirrored | No | Possibly (Redis, short TTL) | No |
| Vote choice + tally count | **Yes** | Mirrored via `IndexedVoteEvent` | No | Rollup is cached/derived | `AnalyticsRollup` derived from `IndexedVoteEvent` |
| Election existence/timing/state | **Yes** | Mirrored in `ElectionMetadata.state` | No | No | No |
| Election title | **Yes** (on-chain struct) | Mirrored | No | No | No |
| Election description (long-form) | No | **Yes — authoritative** | No | No | No |
| Candidate name | **Yes** (on-chain struct) | Mirrored in `IndexedCandidate` (Phase 7 - referenced, not embedded) | No | No | No |
| Candidate bio | No | **Yes — authoritative**, in `CandidateProfile` (referenced, not embedded) | No | No | No |
| Candidate photo | No (CID ref only) | No | **Yes — authoritative** | CDN/gateway caching | No |
| Candidate `metadataURI` (CID) | **Yes** (the pointer) | Mirrored in `IndexedCandidate` (Phase 7) | N/A | No | No |
| Registration request workflow state | No (only final approval is on-chain) | **Yes — authoritative** for workflow | No | No | No |
| Admin role assignments | **Yes** (on-chain `AccessControl`) | Mirrored in `AdminUser` | No | No | No |
| Turnout % / participation-over-time | No | **Yes**, but explicitly derived | No | Yes (this *is* the cache) | **Yes — fully derived** |
| Notification preferences | No | **Yes — authoritative** | No | No | No |
| SIWE session/JWT | No | Session store (or stateless JWT) | No | Yes | No |
| Transaction receipts / vote receipts | **Yes** (Etherscan-queryable) | Stored alongside `IndexedVoteEvent` | No | No | No |

**Reasoning summary:**
- Anything trustless and independently verifiable (eligibility, votes,
  tallies, roles, election timing) lives on-chain — MongoDB only mirrors it.
- Anything large, mutable, or purely presentational (descriptions, bios,
  images) lives off-chain — no trust benefit from storing it on-chain.
- Workflow state (pending registration, drafts) lives only in MongoDB — the
  chain shouldn't represent "in progress, not yet decided."
- Derived numbers (turnout %, participation curves) are explicitly marked
  Derived, never authoritative.

---

## 12. Security Design

- **Wallet security:** App never requests/stores private keys; all signing
  in the user's wallet. SIWE messages include a nonce and domain binding.
- **Replay attacks:** SIWE nonces single-use and expire; on-chain,
  Ethereum's native nonce protection.
- **Double voting:** Enforced on-chain via a `hasVoted` mapping checked in a
  `require` before any tally update — covered by dedicated tests.
- **Unauthorized election creation:** Gated by `onlyAdmin`/role-based
  modifiers; tested with a non-admin call expecting a revert.
- **Role management:** Grants/revocations restricted to
  `SYSTEM_ADMINISTRATOR_ROLE`, with events emitted for auditability.
- **Input validation:** Both client-side (UX) and contract-side
  (authoritative).
- **Reentrancy:** Checks-effects-interactions ordering;
  `ReentrancyGuard` applied defensively to vote-casting.
- **Integer overflow:** Solidity ^0.8.x built-in checks by default.
- **Front-running:** Vote choice visible in the public mempool before
  confirmation — a documented, known limitation; anonymous voting is a
  Future Enhancement.
- **Signature verification:** SIWE backend verification checks domain,
  nonce, and expiry.
- **Blockchain Service Layer as a security boundary:** because every
  contract call funnels through one module (Section 7.2), security review
  of "how does the backend talk to the chain" examines one piece of code.

**Known limitation to state explicitly in the README:** this design does
not achieve voter anonymity. It achieves integrity and tamper-resistance,
not privacy — different properties. Privacy is a Future Enhancement.

---

## 13. User Roles (Expanded Hierarchy)

```
Guest
  ↓
Wallet User
  ↓
Verified Voter
  ↓
Election Administrator
  ↓
System Administrator
```

| Role | Permissions | Responsibilities | Restrictions |
|---|---|---|---|
| **Guest** | View public election list and results | None | No wallet connected; cannot vote, register, or see account-specific views |
| **Wallet User** | Everything Guest can, plus: connect wallet, view personalized eligibility, submit registration requests | Keep wallet secure | Not yet eligible to vote; no admin access |
| **Verified Voter** | Everything Wallet User can, plus: vote in approved elections, view own receipts/history | Cast vote responsibly within the active window | Cannot vote twice or in unapproved elections; cannot manage elections |
| **Election Administrator** | Everything Verified Voter can (if also personally verified), plus: create/manage elections, approve/reject registrations, end elections, view election-level analytics | Configure valid parameters, review requests fairly | Cannot grant/revoke admin roles; cannot alter cast votes; cannot pause system globally |
| **System Administrator** | All Election Administrator permissions, plus: grant/revoke any admin role, pause/unpause system-wide, cross-election analytics | Manage overall integrity and emergency response | Should be a multisig wallet in any non-trivial deployment |

**Why this hierarchy is beneficial:**
- **Granular onboarding funnel:** separates "has a wallet" from "is allowed
  to vote," giving the frontend natural CTAs at each stage.
- **Least privilege:** each tier adds exactly the permissions it needs.
- **Mirrors realistic production systems:** transferable to future projects
  (e.g., e-commerce: guest → account holder → verified buyer → store admin →
  platform admin).
- **Clear escalation path for review:** every elevation is an explicit,
  auditable action — supports Section 17's audit logging.

---

## 14. Complete User Journey

1. **Opening the website** — Guest sees public election list/results.
2. **Connecting wallet** — becomes Wallet User; confirms Sepolia network.
3. **Registering** — submits a registration request → admin's pending queue.
4. **Admin reviews and approves** — triggers an on-chain `registerVoter` tx.
5. **Voter sees eligibility update** — becomes Verified Voter once confirmed.
6. **Voting** — selects candidate, signs `vote()`, waits for confirmation,
   sees receipt and "You voted" state.
7. **Viewing results** — live/post-end tally from indexed events, with a
   "verify on Etherscan" link.
8. **Admin ending elections** — transitions through the state machine
   (Section 16) to Voting Ended; no further votes accepted.
9. **Verifying votes** — anyone can independently query the contract or
   Etherscan to confirm tallies match emitted `VoteCast` events.

---

## 15. Smart Contract Interaction Flow

```
Frontend (Wagmi)  →  prepares transaction (function + args)
       │
       ▼
Wallet (MetaMask)  →  user reviews gas estimate & calldata, signs
       │
       ▼
Blockchain (Sepolia via RPC)  →  transaction enters mempool, gets mined
       │
       ▼
Transaction confirmation  →  receipt returned with status + emitted events
       │
       ▼
Event emission  →  e.g., VoteCast(electionId, voter, candidateId)
       │
       ▼
Frontend updates  →  Wagmi/React Query invalidates relevant cached reads,
                      UI re-renders with new tally / "has voted" state;
                      the Background Worker (Section 8), via the Blockchain
                      Service Layer's subscription, separately picks up the
                      same event to update MongoDB for fast future reads
```

---

## 16. Election State Machine

```
Draft
  ↓
Registration Open
  ↓
Registration Closed
  ↓
Voting Scheduled
  ↓
Voting Active
  ↓
Voting Ended
  ↓
Result Finalized
  ↓
Archived
```

| State | Transitions To | Allowed Actions | Backend Responsibilities | Contract Responsibilities | Frontend Behavior |
|---|---|---|---|---|---|
| **Draft** | Registration Open | Admin edits title/description/candidates | Store draft in MongoDB only; nothing on-chain yet | None — contract doesn't know about this election yet | Admin Dashboard only |
| **Registration Open** | Registration Closed | Voters submit requests; admin approves/rejects | Accept/track requests; approval triggers on-chain calls | Election created on-chain; `VoterRegistry` accepts registration txs | Public listing shows "Registration Open" |
| **Registration Closed** | Voting Scheduled | No new requests accepted | Reject new requests with a clear error | Optional registration cutoff enforcement | "Registration closed" messaging |
| **Voting Scheduled** | Voting Active (automatic, at `startTime`) | Read-only — countdown | Worker watches `startTime`, updates state | Contract's time-window logic governs the transition | Countdown timer |
| **Voting Active** | Voting Ended (automatic at `endTime`, or admin-triggered early end if paused) | Verified Voters cast votes | Worker indexes `VoteCast` events live; rollup updates live | `vote()` accepts calls; `hasVoted`/time-window checks enforced | Voting UI enabled; live tally optionally shown |
| **Voting Ended** | Result Finalized | No more votes accepted | Worker flags any post-`endTime` vote event as anomalous, not valid | Contract rejects further `vote()` calls past `endTime` | "Voting has ended"; results shown as provisional |
| **Result Finalized** | Archived | Admin calls explicit `finalizeElection()` (per ADR-006) | Worker locks the `AnalyticsRollup` as final; triggers notifications | `finalizeElection()` admin call (explicit transaction, per ADR-006) | Results marked "Final"; receipts/verification links shown |
| **Archived** | *(terminal)* | Read-only, historical record | Excluded from "active" listings, remains queryable | Data remains permanently on-chain | "Archive" / "Past Elections" view |

**Why a state machine simplifies implementation and prevents invalid
operations:**
- Turns "can the admin do X right now?" into a single lookup against the
  allowed-actions table, rather than scattered ad hoc checks.
- Makes invalid operations structurally unrepresentable in the UI (though
  the contract check remains the authoritative backstop).
- Gives the worker and analytics module an unambiguous signal for when to
  lock in final numbers vs. when tallies are provisional.
- Supports the audit logging strategy (Section 17): every state transition
  is a natural audit log event.

---

## 17. Logging and Audit Strategy

**Categories of logs:**
- **Frontend logs:** client-side errors sent to Sentry with reproducible
  context, never logging sensitive PII.
- **Backend logs:** structured (Pino, JSON), tagged `service: "api"` or
  `service: "worker"`, with a request/job correlation ID.
- **Blockchain event logs:** the raw events are inherently a permanent
  public log on-chain/Etherscan; the worker's ingestion failures (malformed
  event, missed checkpoint) are logged as backend ERROR-level events.
- **Audit logs:** a dedicated, append-only `AuditLog` collection for
  privileged actions — role grants/revocations, registration
  approvals/rejections, election state transitions. Never rotated/deleted
  on a short retention window.

**Severity classification:**

| Severity | Meaning | Example |
|---|---|---|
| **INFO** | Normal expected operation | "Worker processed VoteCast event for election 4" |
| **WARNING** | Recoverable anomalies | "RPC provider Alchemy timed out, falling back to Infura" |
| **ERROR** | Failed operations needing attention | "Failed to upsert IndexedVoteEvent — Mongoose validation error" |
| **CRITICAL** | System-level failures requiring immediate response | "Worker has not processed a new block in 10 minutes" |
| **AUDIT** | Privileged/security-relevant actions, regardless of success/failure | "Wallet 0xABC granted ELECTION_ADMINISTRATOR_ROLE by 0xDEF" |

**How this supports debugging, monitoring, compliance, and security
investigations:** correlation IDs reconstruct a single action across
processes; severity levels map to alerting thresholds; the non-rotating
AUDIT log demonstrates a pattern a real regulated system (e.g., a future
medical-records project) would need; AUDIT logs provide an independent
cross-check against on-chain role-change events during a security
investigation.

---

## 18. Configuration Management

A dedicated configuration layer centralizes all environment-specific
settings, loaded and validated once at process startup (both API and
worker), rather than read ad hoc via `process.env` scattered through the
codebase.

**Configuration modules:** Blockchain (RPC URLs, chain ID, contract
addresses per network, ABI version mapping), MongoDB (connection URI, pool
size, retry settings), IPFS (pinning provider keys, gateway URL),
Authentication (SIWE domain/expiry, session secret), Docker (compose service
definitions), Environment variables (a single validated schema via zod),
External services (Sentry DSN, email/webhook credentials, Tenderly
settings).

**Why centralized configuration improves maintainability and deployment:**
- One place to understand every external dependency.
- Startup-time validation converts "works on my machine" env-var bugs into
  immediate, clear startup failures.
- API and worker share the same configuration module — no risk of silent
  disagreement about contract address or database.
- Makes the versioning strategy (Section 6.1) operationally real: a new
  contract version is a configuration change, not a code change scattered
  across modules.

---

## 19. Deployment Architecture

**Local Development:** Hardhat local node; backend via `docker-compose`
(API + worker + local MongoDB + local Redis); frontend via Vite dev server
pointed at the local Hardhat RPC and locally deployed addresses.

**Testnet:** Contracts deployed to Sepolia via Hardhat scripts, verified on
Etherscan; API and Worker deployed as two separate Render/Railway services,
both pointed at Sepolia via Alchemy; frontend deployed to Vercel.

**Production** (public Sepolia deployment, no mainnet): Same as Testnet,
with production-grade env vars, Sentry enabled on both processes, custom
domain.

**Docker usage:** `docker-compose.yml` for local dev (MongoDB + Redis + API
+ worker, optionally a local Hardhat node container); separate Dockerfiles
(or shared base image, different start commands) for API and worker in
production.

**Environment Variables / Secrets** (validated via Section 18):
`RPC_URL` (primary), deployer private key (dedicated, low-value, never
reused as a backend signer key), `MONGODB_URI`, `REDIS_URL`,
`JWT_SECRET`/SIWE session secret, `IPFS_API_KEY`, contract addresses + ABI
versions per network.

**RPC Providers:** Primary Alchemy, fallback Infura, managed by the
Blockchain Service Layer's provider creation logic.

---

## 20. Folder Structure

```
decentralized-voting-system/
├── contracts/
│   ├── contracts/
│   │   ├── VoterRegistry.sol
│   │   ├── Election.sol
│   │   └── AccessControl.sol  (or imported from OpenZeppelin)
│   ├── scripts/
│   │   ├── deploy.ts
│   │   └── verify.ts
│   ├── test/
│   │   ├── VoterRegistry.test.ts
│   │   └── Election.test.ts
│   ├── hardhat.config.ts
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── modules/                        ◄── domain-driven (Section 7.1)
│   │   │   ├── auth/
│   │   │   ├── election/
│   │   │   ├── candidate/
│   │   │   ├── voting/
│   │   │   ├── blockchain/                  ◄── the ONLY module that imports ABIs /
│   │   │   │                                   holds a provider/signer (Section 7.2)
│   │   │   ├── wallet/
│   │   │   ├── analytics/
│   │   │   ├── notifications/
│   │   │   ├── admin/
│   │   │   └── ipfs/
│   │   ├── config/                          ◄── shared infrastructure (Section 18)
│   │   ├── middleware/                      ◄── shared infrastructure
│   │   ├── utils/                           ◄── shared infrastructure
│   │   ├── docs/
│   │   └── app.ts                           (API process entrypoint)
│   │
│   ├── worker/
│   │   ├── worker.ts                        (worker process entrypoint, Section 8)
│   │   ├── jobs/
│   │   └── checkpoint.ts
│   │
│   ├── test/
│   ├── Dockerfile.api
│   ├── Dockerfile.worker
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── App.tsx
│   ├── vite.config.ts
│   └── package.json
│
├── shared/
│   ├── abi/                      (generated ABIs + TypeChain types)
│   └── contract-addresses.json
│
├── docs/
│   ├── architecture/
│   │   ├── architecture.md       (this document)
│   │   └── ADR/
│   ├── threat-model.md
│   └── decision-log.md
│
├── docker-compose.yml
└── README.md
```

Every folder under `backend/src/modules/` follows the same internal shape
(model + service + routes), which is what makes the reuse argument in
Section 23 concrete.

---

## 21. Development Roadmap

| Phase | Name | Dependencies | Deliverables |
|---|---|---|---|
| 1 | Environment Setup | none | Monorepo scaffolded, Hardhat initialized, Docker Compose working, lint/format configured |
| 2 | Smart Contracts | Phase 1 | `VoterRegistry`/`Election` per Section 6, full unit tests, Slither clean, deployed+verified on Sepolia |
| 3 | Blockchain Service Layer | Phase 2 | `blockchain` module fully implemented (Section 7.2), isolated test suite |
| 4 | Frontend (core flows) | Phase 2 (parallel with 3/5) | Wallet connection, election listing, candidate display, vote-casting against live Sepolia contract, basic results |
| 5 | Backend Domain Modules | Phase 3 | All domain modules implemented per Section 7.1/7.3, state machine reflected in election module |
| 6 | Background Worker | Phase 3 and 5 | Worker listening via Blockchain module, analytics/notifications wired via direct enqueue (ADR-007), BullMQ with retries, checkpointing |
| 7 | Logging, Audit, Configuration | Phase 5 and 6 | Pino logging, `AuditLog` mechanism, centralized validated config layer |
| 8 | Integration | Phases 4, 5, 6 | Frontend fully wired to backend APIs, error handling for all failure paths |
| 9 | Testing | Phase 8 | E2E tests (Playwright), contract coverage threshold, backend tests against in-memory MongoDB, security review checklist |
| 10 | Deployment & Polish | Phase 9 | Production deployment, monitoring wired up, README with diagrams and Etherscan links, demo materials |

---

## 22. Future Enhancements

- **Zero-Knowledge Proofs** — replace plaintext vote-candidate links with
  ZK-SNARK proofs of valid eligibility without revealing candidate choice.
- **DAO Governance** — evolve System Administrator into a token-weighted or
  multisig DAO.
- **Multi-chain Support** — deploy to other EVM chains using the existing
  provider-abstraction.
- **Quadratic Voting** — modify vote-weighting logic.
- **Anonymous Voting** — commit-reveal scheme as a stepping stone to ZK.
- **Identity Verification** — DID or proof-of-personhood (e.g., World ID).
- **Mobile Application** — React Native or wallet-deep-link mobile flow.
- **Full proxy-based contract upgradeability** — the OpenZeppelin UUPS path
  explicitly deferred in Section 6.1.

---

## 23. Modular Architecture for Reuse

This project is explicitly the first in a family of blockchain-backed
systems (medical records, supply chain tracking, certificate verification,
digital identity). All share a common shape: authoritative on-chain event
log, reactive off-chain indexer in a worker process, derived analytics, and
notifications — only the domain entities differ.

**Modules designed for direct reuse:** `blockchain`, `auth`,
`notifications`, `analytics`, `ipfs`, and the Background Worker architecture
itself (the listener/job-queue/checkpoint pattern is domain-agnostic by
construction).

**Modules that remain domain-specific:** `election`, `candidate`, `voting`,
`admin` — these are the template for how to write a new domain module, not
reusable code itself.

**Architectural implication:** scoping a future project means "fork the
reusable modules, write new domain modules following the same shape, write
new smart contracts" — not "rewrite the backend from scratch."

---

## 24. Production Readiness Enhancements

Each addition evaluated against "does this provide genuine value at this
project's scale" — no Kafka, no full microservices split beyond API/worker,
no Kubernetes.

- Structured logging (Pino) across both processes
- OpenAPI/Swagger documentation
- Idempotent event ingestion with checkpointing in the worker
- Rate limiting on public write endpoints
- Centralized error handling middleware
- `mongodb-memory-server` for backend tests
- Environment variable validation at startup (Section 18)
- CI pipeline gating (GitHub Actions: contract tests, Slither, backend
  tests, frontend build/lint, branch protection)
- Job queue with retry/backoff (BullMQ) for notifications/analytics
- Audit logging for all privileged actions

### Architectural Decisions Requiring Human Approval Before Implementation

See `docs/architecture/decisions-log.md` and `docs/architecture/ADR/` for
the resolution and reasoning behind every item below:

1. Single-contract vs. Factory pattern → **Single contract** (ADR-005)
2. On-chain vote privacy out of scope for v1 → **Confirmed**
3. Non-upgradeable contracts in V1, versioned redeployment → **Confirmed** (ADR-005)
4. AccessControl vs. Ownable → **AccessControl** (ADR-005)
5. Registration approval requires an on-chain tx per voter → **Confirmed**
6. Sepolia testnet only, no mainnet → **Confirmed**
7. No legal/real-world election compliance → **Confirmed**
8. MongoDB over a relational database → **MongoDB** (ADR-001)
9. No dedicated message broker beyond BullMQ/Redis; analytics rollups
   trigger via direct enqueue, not MongoDB Change Streams → **Superseded
   from original Change-Streams wording** (ADR-007)
10. Separate API and worker processes → **Confirmed, kept separate** (ADR-002)
11. Five-tier role hierarchy → **Confirmed, kept as designed**
12. *(Added at implementation kickoff)* `Voting Ended → Result Finalized` transition → **Explicit `finalizeElection()` transaction** (ADR-006)

---

## Additional refinement — Internal Event Bus, ADRs, Correlation IDs, Retry/DLQ, Health Checks

The following items were proposed as the final pre-implementation polish
pass and are tracked for their respective implementation phases rather than
applied retroactively to earlier sections:

- **Internal Event Bus** — BullMQ (already selected for the job queue,
  Section 8) doubles as this: the worker publishes a job per indexed event,
  and analytics/notifications/cache-update/audit consumers subscribe
  independently, rather than the worker calling each downstream concern
  directly. This avoids a dedicated pub/sub layer (e.g., a separate
  EventEmitter abstraction) duplicating what BullMQ's queue-per-concern
  pattern already provides — implemented as part of Phase 6.
- **ADR folder** — implemented now; see `docs/architecture/ADR/`.
- **Request Correlation IDs** — implemented in Phase 1 scaffolding
  (`backend/src/middleware/requestLogger.ts`) ahead of schedule, since it's
  foundational to every other module's logging.
- **Retry + Dead Letter Queue** — BullMQ's built-in retry/backoff and failed-
  job tracking serve this role; implemented as part of Phase 6 alongside the
  notification queue.
- **Health Check Architecture** (`/health`, `/ready`, `/metrics`) —
  `/health` implemented in Phase 1 scaffolding (`backend/src/app.ts`);
  `/ready` (verifying MongoDB/Redis connectivity) and `/metrics` to be added
  in Phase 7 (Logging, Audit, and Configuration) alongside the rest of the
  observability work.
- **Sequence diagrams for every major flow** — vote casting and registration
  approval are documented in Section 3.1; Create Election, Register Voter,
  Event Processing, and Finalize Election sequence diagrams will be added to
  this document during Phase 5/6 implementation, once their exact message
  shapes are finalized.