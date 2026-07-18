# Decentralized Voting System — Session Handoff

Paste this entire document at the start of a new chat, along with the
project zip. This replaces re-explaining context from scratch.

**This document was rewritten and condensed on 2026-07-18.** Everything
that follows reflects confirmed current state, not a session-by-session
history. If you need the full narrative of how each piece was built
(design forks, bugs found along the way, exact session dates), that's in
this repo's chat history / prior HANDOFF versions — it is not repeated
here because none of it is still a live decision point.

## What this project is

A production-inspired decentralized voting platform on Ethereum (Sepolia
testnet, now actually deployed there — see below). Flagship portfolio
project: blockchain fundamentals (Solidity, Hardhat, OpenZeppelin
AccessControl) plus a production-grade, domain-driven backend (Express
API + separate worker, MongoDB, viem) and a React frontend. Full
architecture is in `docs/architecture/architecture.md` — read that first,
it's the single source of truth. Every significant design decision is
recorded in `docs/architecture/ADR/`.

**Working agreement:** implement strictly per the approved architecture.
Never silently change it — if implementation reveals a problem, stop,
explain it, propose options with trade-offs, wait for approval.
Industry-level code only, no shortcuts. Each phase/module gets a short
technical design doc (objective, files, forked decisions with real
trade-offs) before coding starts, and explicit approval on any forked
decision before implementing. **File delivery: always individual files,
never zips.**

## The verification discipline — the single most important thing here

**Every claim of "this works" must be backed by an actual command that
was actually run, with actual output observed** — never reasoning about
what should happen. This project has repeatedly found real bugs (wrong
runtime behavior despite clean type-checking, library behavior that
didn't match its own type signature, RPC-provider limits no amount of
code review would surface) that pure reasoning would never have caught.
The pattern:

1. Propose a design, get explicit approval on forked decisions.
2. Implement, verify everything verifiable in-sandbox at each step
   (`tsc --noEmit`, `eslint`, unit tests that don't need blocked network
   hosts — see below).
3. Hand off exact commands to run and exactly what output to expect —
   never assume success.
4. User runs commands, pastes real output. Compare against the
   prediction. Match → confirmed. Mismatch → STOP, investigate with real
   evidence, don't stack unverified fixes.
5. When something can't be verified at all in-sandbox, say so explicitly
   and wait for the user's real output before claiming success.

**Known in-sandbox network restrictions** (environment limits, not code
bugs — don't assume the user's own machine is equally restricted, always
ask them to actually run the thing):
- `binaries.soliditylang.org` unreachable → `hardhat compile`/`test`
  can't run in-sandbox. Workaround: `contracts/verify-compile.cjs`
  (compiles via the `solc` npm package directly).
- `fastdl.mongodb.org` unreachable → `mongodb-memory-server`-based tests
  can't run in-sandbox. Confirmed reachable on the user's own machine.
- No path to Alchemy/Infura/Etherscan/faucets from the sandbox at all —
  anything touching real Sepolia infrastructure has to run on the user's
  machine, always.
- Real `pnpm install`, arbitrary bash, file read/write ARE available —
  don't assume more is blocked than actually is.

## Current state (confirmed 2026-07-18)

### Contracts — deployed and verified on Sepolia, admin role on a Safe multisig

Deployed via `pnpm --filter @dvs/contracts deploy:sepolia`, both
contracts verified on Etherscan via `verify:sepolia`:

| | Address |
|---|---|
| `VoterRegistry` | `0xe3e0FE6EEeE224c8c323BDb88fBd2f182Ffc965E` |
| `Election` | `0xB0C9423C0504406cCb0c0981e8B3Bc1053d564Ff` |
| Deployer wallet | `0xD39F4a64A2aD76B89c3f3e974F1CA4D0167a6977` |
| Safe (multisig) | `0x1D0862710Bce57fD6B31881720045a433ce197f4` |
| Deployment block | `11297146` |

`SYSTEM_ADMINISTRATOR_ROLE` has been granted to the Safe and renounced
from the deployer on both contracts (confirmed via `hasRole` returning
`[true, true]` before renouncing, then real on-chain renounce txs).
**Caveat, not a bug**: the deployer wallet still holds `DEFAULT_ADMIN_ROLE`
(a separate, more fundamental AccessControl role never touched by this
handoff) — this is the documented, as-designed behavior
(`AccessRoles.sol`'s own header comment), meaning the handoff is soft,
not an absolute lockout. `ELECTION_ADMINISTRATOR_ROLE` is still held by
the deployer on both contracts (not migrated to the Safe — only
`SYSTEM_ADMINISTRATOR_ROLE` was, per the deploy script's own printed
guidance).

`shared/contract-addresses.json` is keyed **by chain ID** (`"31337"` /
`"11155111"`), not by Hardhat network name — this was briefly reverted
mid-project and then re-applied after it turned out to be a real,
reproducible blocker for the Docker dev stack, not just a latent Sepolia
concern. **Do not revert this again** without checking
`frontend/src/lib/contractAddresses.ts`'s lookup and
`backend/test/integration/harness.ts`'s reader first, since both must
match whatever key shape this file uses. This file is gitignored (local
deploy output) — a fresh checkout needs a real deploy (or, for CI/build
purposes only, an empty `{}` placeholder) to populate it.

Local Hardhat deploys still work exactly as before via `pnpm dev`
(Docker stack) — the Sepolia deploy didn't touch that path.

### Backend — two isolated environment profiles, both working

This backend can only ever mirror **one chain at a time** (`env.ts` has
one flat `RPC_URL_PRIMARY`/`CHAIN_ID`/`CONTRACT_ADDRESS_*` set, not a
per-chain map) — so local Hardhat and Sepolia are two **separate,
non-overlapping** `.env` profiles, never run simultaneously against the
same database:

- **`backend/.env.docker`** — used by `pnpm dev` (the Docker overlay).
  Local Hardhat, `CHAIN_ID=31337`, its own Mongo/Redis containers. Your
  default day-to-day dev setup, unaffected by anything below.
- **`backend/.env`** — used by native `pnpm --filter @dvs/backend
  dev:api` / `dev:worker` (no Docker). Now configured for **Sepolia**:
  `CHAIN_ID=11155111`, the real deployed addresses above,
  `WORKER_START_BLOCK=11297146`, and its own **separate MongoDB
  database** (`decentralized-voting-system-sepolia`, distinct from local
  Hardhat's `decentralized-voting-system`) — this separation is required,
  not cosmetic: `WorkerCheckpointModel` is keyed only by event name, with
  **no chain-ID scoping at all** (a real, previously-undiscovered gap in
  this codebase), so two chains sharing one database will corrupt each
  other's worker checkpoints. If a future session ever adds a third
  environment (e.g. a different testnet), it needs its own database too,
  for the same reason.

**A real, permanent Alchemy free-tier limitation was found and fixed**:
`eth_getLogs` is capped at a 10-block range per call on the free tier,
and a single call spanning a larger catch-up gap (inevitable after a
fresh deploy, or any time the worker's been offline a while) is rejected
outright, not partially served. Fixed properly, not worked around: `
getNewLogs()` in `backend/src/modules/blockchain/events.ts` now chunks
any catch-up range into `RPC_GET_LOGS_MAX_BLOCK_RANGE`-sized windows
(new configurable env var, default `10`), sequentially. New test file
`backend/test/blockchain/events.test.ts` (5 tests, pure unit, no Mongo
needed) covers this. **Confirmed working on the user's real Sepolia
worker** — clean startup, no `InvalidRequestRpcError`, catches up through
the real ~1,000 block gap from deploy block to chain tip.

All 7 backend architecture gaps, all "pre-frontend" items, rate limiting,
webhooks, election-start reminders, the CI pipeline (real green GitHub
Actions run), Swagger docs, and the Wallet module are done and were
confirmed by real `pnpm test` runs earlier in this project's history —
see git history / prior HANDOFF versions if the specifics of any of
those ever matter again. **Needs a fresh real `pnpm --filter backend
test` run** to get an authoritative current test count, since several
things (adminMyElections, the lifecycle-state gap closing, this session's
chunking fix) were added after the last confirmed full-suite number.

### Frontend — all 7 pages built, wallet-disconnect bug fixed

All 7 Section 9 pages (Landing, Election Detail, Voter Dashboard, Admin
Dashboard, Create Election wizard, Registration Requests, Results/
Archive) have real content, each verified with `tsc -b`/`eslint`/
`vitest`/`vite build` at the time it was built.

**Fixed this session**: wallet-disconnecting through RainbowKit's own
account modal didn't clear the backend SIWE session (`useAuth.ts`) — a
real race between two effects (session-restore, keyed on `walletAddress`,
and the logout-clearing effect, keyed on `isConnected`) both firing on
disconnect, with the session-restore effect's in-flight `GET
/auth/session` resolving after the logout call and silently overwriting
its "idle" state back to "authenticated". Fixed by skipping the
session-restore fetch entirely when there's no `walletAddress`. Covered
by `useAuth.test.tsx` (3 tests, re-added this session after being
dropped from an earlier zip). **Verified in-sandbox this session**:
`tsc -b` ✅, `eslint .` ✅, `npx vitest run` ✅ **89/89 tests across 23
files**, `vite build` ✅. Not yet re-confirmed on the user's own machine.

**Known, deliberately deferred, not urgent**: on-chain write hooks
(`useCreateElectionOnChain`, `useAddCandidate`, `useCastVote`,
`useConfirmRegistration`) have no dedicated tests — every other page's
core logic is covered, but wagmi's `useWriteContract`/
`useWaitForTransactionReceipt` state-transition surface plus event-log
decoding was judged to need substantially heavier mocking than was
worth it at the time. Worth a dedicated pass if it becomes a priority.

The Docker one-command dev stack (`pnpm dev`) is confirmed working
end-to-end on the user's own machine after fixing four real bugs found
via live debugging (env_file merging, the chain-ID key mismatch above,
a poisoned-entry crash in the addresses file, and a stale reader in the
integration test harness) — nothing further needed there.

## Known open items (small, non-blocking)

1. **`admin.service.ts`'s `submitRegistrationRequest` doesn't reject
   requests once registration is closed** — deliberately left open (own
   comment in `election.service.ts`'s header explains why: gating on
   `listElections()` would wrongly break registration for elections that
   exist purely on-chain without a Mongo draft). Needs its own design
   pass if it becomes a priority.
2. **`viem` version-duplication editor diagnostic** — a `pnpm-workspace.yaml`
   `overrides:` fix was designed but never applied to the current tree.
   Purely a TypeScript editor annoyance (`vitest` transforms via esbuild
   and never type-checks, so it's never blocked a real test run) — low
   priority.
3. **No end-to-end smoke test on Sepolia yet** — every piece has been
   verified independently (deploy, role transfer, verify, worker sync),
   but nobody has yet walked through creating a real election via the
   Create Election wizard end-to-end against the live Sepolia deployment
   and confirmed it shows up correctly on Landing/Election Detail. Worth
   doing before considering the Sepolia integration fully proven.
4. **Backend test suite needs a fresh real `pnpm --filter backend test`
   run** for an authoritative current count (see Backend section above).

## Durable design decisions (still governs future work)

- **Contract addresses**: per-chain, keyed by chain ID, in
  `shared/contract-addresses.json`. See Contracts section above — do not
  revert to network-name keying.
- **Two environment profiles, never simultaneous, never sharing a
  database**: `.env.docker` (local Hardhat) vs `.env` (native, currently
  Sepolia). See Backend section above.
- **Wallet-direct writes**: `vote()`, `createElection()`,
  `addCandidate()`, `registerVoter()`-confirmation, etc. are all signed
  directly by the connected wallet, never relayed through the backend —
  the backend is a read-mirror plus off-chain admin workflow (drafts,
  IPFS uploads, notification preferences), never a transaction relay.
- **Role checks are always live, never from the mirror**: `requireRole`
  middleware does a real `hasRole()` contract read on every request —
  deliberately not cached, not backed by the worker's indexed data.
- **`confirmed` (emerald) is reserved for on-chain-confirmed state only**
  in the frontend's design system — vote cast, election finalized,
  registration approved. This is the one real semantic promise the color
  system makes; don't use it for anything else.
- **Results hidden until `voting_ended`/`result_finalized`** — a UX
  choice (avoid bandwagon effects), not a security boundary; the
  underlying endpoint is public either way.

## Non-obvious lessons worth not re-learning

- **`env.ts` is a module-load-time singleton frozen on first import.** A
  test that mutates `process.env` after an already-cached import of a
  module that (even transitively) imports `env.ts` silently does
  nothing. Fix: `vi.resetModules()` before each re-import that needs a
  different env value — a per-test cache-busting query string on the
  *directly* re-imported module is not enough if that module has its own
  *nested* static import of `env.ts`, since the query string only busts
  the outer module's cache, not its dependencies'.
- **A free-tier RPC provider's `eth_getLogs` range limit is a real,
  permanent constraint**, not a one-off error to retry past — Alchemy's
  free tier hard-caps it at 10 blocks and rejects a larger range outright
  (no partial results). Any code issuing a single unbounded `eth_getLogs`
  call for a catch-up range will break the first time that gap exceeds
  the provider's limit, whether from a fresh deploy or the worker having
  been offline. Chunk defensively regardless of which provider is
  currently configured.
- **`res.locals` type augmentation**: `declare module "express" {
  interface Locals {...} }` does NOT actually type `res.locals` — use
  `declare global { namespace Express { interface Locals {...} } }`
  instead.
- **`.js`-extension relative imports under CommonJS + classic Node
  resolution** (contracts package) type-check fine but fail at runtime.
  Use no extension there. Backend's `NodeNext` resolution is the
  opposite — `.js` extensions are required.
- **ESLint flat config, files outside `tsconfig.json`'s `include`** (e.g.
  `backend/test/` isn't in `backend/tsconfig.json`'s `include`) still
  need `languageOptions.parser` set explicitly or they silently fall back
  to plain-JS parsing. This also means **`tsc --noEmit` run from the
  package root silently skips type-checking anything under `test/`** —
  a clean CLI result does not guarantee the editor's own TS server (which
  checks open files regardless of `include`) will agree. If the editor
  flags something the CLI didn't, check `include` before assuming either
  tool is wrong.
- **A library's TS type signature isn't its actual runtime behavior**:
  `siwe`'s `.verify()` is typed to always resolve but actually rejects on
  verification failure.
- **viem decodes a named-struct/tuple Solidity return as a plain object
  keyed by field name, not a positional array** — casting to a tuple type
  lies to TypeScript but throws at runtime.
- **Coinbase Wallet's SDK refuses `wallet_switchEthereumChain` for any
  chain outside its own allow-listed set** (mainnet, Base, a few L2s) —
  it cannot be used to connect to local Hardhat or any custom network.
  Use MetaMask (or another connector that supports arbitrary custom
  networks) for local-chain development.
- **Never run two AI coding agents against the same working tree at the
  same time** — a second concurrent editor has previously overwritten
  already-verified files without any import error, silently reintroducing
  bugs. If a file's on-disk content doesn't match what was last delivered
  and verified, and nothing in the current conversation touched it, check
  for a second concurrent editor before assuming a mistake.

## Files worth knowing about at repo root

- `shared/contract-addresses.json` — per-chain contract addresses, keyed
  by chain ID. Gitignored. Currently has real Sepolia addresses (see
  Contracts section above) alongside whatever local Hardhat entry exists
  from `pnpm dev`.
- `contracts/verify-compile.cjs` — sandbox-network-workaround compile
  script (bypasses Hardhat's downloader). Keep it.
- `.github/workflows/ci.yml` — CI pipeline, confirmed green on a real
  GitHub Actions run.
- `backend/.env.docker.example` / `backend/.env.example` — templates for
  the two environment profiles described above.

## Next steps

1. Re-establish the verification discipline explicitly at the start of
   any new session. Confirm no other AI agent is concurrently editing
   this working tree first.
2. Run a fresh real `pnpm --filter backend test` for an authoritative
   current test count.
3. Do an actual end-to-end smoke test on Sepolia: create a real election
   via the Create Election wizard, confirm the worker mirrors it,
   confirm it renders correctly across Landing/Election Detail/Admin
   Dashboard.
4. Pick from "Known open items" above based on priority — none are
   urgent, all are small.