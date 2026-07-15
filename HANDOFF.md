# Decentralized Voting System — Session Handoff

Paste this entire document at the start of a new chat, along with the
project zip. This replaces re-explaining context from scratch.

## What this project is

A production-inspired decentralized voting platform on Ethereum (Sepolia
testnet). Flagship portfolio project: blockchain fundamentals (Solidity,
Hardhat, OpenZeppelin AccessControl) plus a production-grade,
domain-driven backend (Express API + separate worker, MongoDB, viem).
Full architecture is in `docs/architecture/architecture.md` — read that
first, it's the single source of truth. Every significant design decision
is recorded in `docs/architecture/ADR/` with reasoning, alternatives, and
consequences.

**Working agreement:** implement strictly per the approved architecture.
Never silently change it — if implementation reveals a problem, stop,
explain it, propose options with trade-offs, wait for approval.
Industry-level code only, no shortcuts. Each phase/module gets a short
technical design doc (objective, files, forked decisions via
`ask_user_input_v0` with real tradeoffs) before coding starts, and
explicit approval on any forked decision before implementing. **File
delivery: always individual files via `present_files`, never zips**
(user's explicit call, 2026-07-13 session — supersedes this doc's
earlier "zip if >3 files" rule).

## The verification discipline — the single most important thing here

**Every claim of "this works" must be backed by an actual command that
was actually run, with actual output observed** — never reasoning about
what should happen. This project has repeatedly found real bugs (wrong
runtime behavior despite clean type-checking, library behavior that
didn't match its own type signature, process-lifecycle races) that pure
reasoning would never have caught. The pattern that works:

1. Propose a design, get explicit approval on forked decisions.
2. Implement, verify everything verifiable in-sandbox at each step
   (`tsc --noEmit`, `eslint`, unit tests that don't need blocked network
   hosts — see below).
3. Hand off with **exact commands to run** and **exactly what output to
   expect** — never assume success.
4. User runs commands, pastes real output.
5. Compare against the prediction. Match → confirmed, move on. Mismatch →
   STOP, investigate with real evidence (ask for specific `ls`/`grep`/
   `cat`/`find` output to pin down facts), don't stack unverified fixes.
6. When something can't be verified at all in-sandbox, say so explicitly
   and wait for the user's real output before claiming success.

**Known in-sandbox network restrictions** (both confirmed, both are
environment limits, not code bugs — they may not apply to the user's own
machine, so always ask them to actually run the thing rather than
assuming their environment is equally restricted):
- `binaries.soliditylang.org` is unreachable → `hardhat compile` /
  `hardhat test` cannot run in-sandbox at all. Workaround for a
  Solidity-only sanity check: `contracts/verify-compile.cjs` (compiles via
  the `solc` npm package directly, bypassing Hardhat's downloader) — this
  proves the Solidity itself is valid, nothing more (no tests, no
  TypeChain types).
- `fastdl.mongodb.org` is unreachable → `mongodb-memory-server`-based
  tests can't run in-sandbox either. (Confirmed reachable on the user's
  own machine — this was environment-specific, not universal.)
- Real `pnpm install` / `npm registry` access, arbitrary bash, and file
  read/write ARE available in-sandbox — don't assume more is blocked than
  actually is; check first.

**Non-obvious lessons worth not re-learning the hard way:**
- **`res.locals` type augmentation**: `declare module "express" {
  interface Locals {...} }` does NOT actually type `res.locals` — it
  silently typechecks but leaves it `any`. The correct form is
  `declare global { namespace Express { interface Locals {...} } }`
  (with a justified `eslint-disable-next-line
  @typescript-eslint/no-namespace`, since there's no ES2015-module
  equivalent for augmenting an ambient global namespace). Only caught by
  eslint's type-aware `no-unsafe-*` rules on code that *reads* from
  `res.locals`, never by `tsc` or by code that only *writes* to it.
- **`.js`-extension relative imports under CommonJS + classic Node
  resolution** (`contracts/tsconfig.json`'s `module: "CommonJS"` +
  `moduleResolution: "node"`) type-check fine but fail at runtime under
  ts-node's `require()` hook (`Cannot find module './x.js'`). Use no
  extension in that setup. (Backend's `NodeNext` resolution is the
  opposite — `.js` extensions are *required* there. Check which
  resolution mode before assuming either convention.)
- **ESLint flat config, files outside `tsconfig.json`'s `include`**: they
  still need `languageOptions.parser: tseslint.parser` set explicitly (and
  the `@typescript-eslint` plugin registered) or they silently fall back
  to plain-JS parsing (espree) and hard-fail on any real TS syntax — not
  a lint finding, a parsing crash. A `.ts` test file using zero
  TS-specific syntax will pass by accident and mask this.
  `parserOptions.project` (type-aware rules) is correctly still absent
  for such files — only the parser itself needs setting.
  `contracts/eslint.config.mjs` avoids the whole issue since its
  `tsconfig.json` actually includes `scripts/`/`test/`; `backend/`'s does
  not, hence the gap.
  - Every dependency a package's own scripts/tests directly need must be
    a **direct devDependency of that package**, never relied on
    transitively — pnpm's strict resolution will silently pick the wrong
    version otherwise.
- **A library's TS type signature isn't its actual runtime behavior**:
  `siwe`'s `.verify()` is typed `Promise<SiweResponse>` (implying it
  always resolves, even on failure), but it actually *rejects* on
  verification failure by default. Confirmed only by a real failing-path
  test; a success-only repro never surfaces this class of gap.
- **viem decodes a single named-struct/tuple Solidity return value as a
  plain JS object keyed by field name, NOT a positional array** — casting
  the result `as [string, bigint, ...]` and destructuring positionally
  type-checks fine (the cast just lies to TypeScript) but throws
  `TypeError: result is not iterable` at runtime.
- **Test harnesses that spawn child processes** (e.g. `npx hardhat node`):
  `npx` often execs the real process as a further child of itself —
  killing only the top-level tracked PID can leave that grandchild alive,
  orphaned, holding a port for the next run. Spawn with `detached: true`
  and kill the whole process group (`process.kill(-pid, ...)`) on
  teardown. A pre-flight "is this port already in use" check should use a
  short grace-period retry, not fail on the very first hit — a process
  from the immediately-preceding run may just be a moment from finishing
  its own shutdown.
- **Never run two AI coding agents against the same working tree at the
  same time.** A separate in-editor agent, active concurrently with this
  chat during Phase 7, independently rewrote several files this chat had
  already delivered correct, verified versions of - at one point
  wiring bogus cross-module imports into `election.service.ts`, at
  another wholesale-replacing `election.routes.ts`'s content with an
  empty router (zero routes registered, but no import error either, so
  `app.use()` didn't throw - every request under that path just silently
  404'd instead). If a file's on-disk content doesn't match what was last
  delivered and verified, and nothing in the current conversation touched
  it, check for a second concurrent editor before assuming a code or
  handoff mistake - ask for the file's actual current content (`cat`)
  rather than guessing from symptoms alone.

## Current project state (confirmed, condensed)

### Contracts — DONE, fully verified
`contracts/contracts/AccessRoles.sol`, `VoterRegistry.sol`, `Election.sol`
— per ADR-005 (single contract, non-upgradeable v1, OpenZeppelin
AccessControl) and ADR-006 (explicit `finalizeElection()` transaction).
Includes OpenZeppelin `Pausable`/`whenNotPaused` on vote-casting,
election-creation, and finalization, gated by `SYSTEM_ADMINISTRATOR_ROLE`,
per Section 6. **39/39 tests passing, 98.08% branch coverage** (the ~2%
gap is one documented, provably-unreachable branch). Both real-user-run
confirmed. Deploy/verify/ABI-extraction scripts real-verified via actual
local deploys. `pnpm lint` (eslint + solhint) 0 errors. Slither and
Sepolia deployment explicitly deferred, user's call.

### Backend — Blockchain Service Layer (ADR-004): DONE, integration-tested
`backend/src/modules/blockchain/` — the sole chokepoint for all contract
reads/writes (provider, signer, event polling, gas, per-contract typed
clients). Real integration test spins up a live local Hardhat node.
**CONFIRMED stable across repeated back-to-back runs.**

### Backend — Domain modules: Auth, Election, Voting, Admin, Candidate, IPFS, Analytics, Notifications, Audit — all DONE

All nine modules are built, wired into `app.ts`, and covered by tests
using real in-memory MongoDB + real SIWE-signed sessions + real HTTP via
`supertest` (no mocking at a layer that matters). Background worker
(`backend/worker/worker.ts`) does per-event-type checkpointed polling of
all 6 core contract events, dual-writing into dedicated indexed
collections (`IndexedElection`, `IndexedCandidate`,
`IndexedVoterRegistration`, `IndexedVoteEvent`, plus a generic
`IndexedChainEvent` log for the rest) so that Election/Voting/Admin/
Candidate reads no longer hit the chain live per-request — except
Candidate's `setCandidateProfile` existence checks, which deliberately
stay live (approved decision: no backend-tracked "just linked" timestamp
exists for candidates the way it does for elections, so a mirror-only
check would wrongly 404 a candidate added moments ago).

**Recurring, deliberate, still-open TODO across every admin-facing write
endpoint** (Election draft/link, Admin approve/reject, Candidate profile
edit, IPFS upload): gated by `requireAuth` only (any logged-in wallet),
not a real `ELECTION_ADMINISTRATOR_ROLE` check. Harmless today because
the actual on-chain transaction a non-admin would need to submit still
reverts at the contract level regardless — but it means the backend
currently trusts session-holders more than the architecture's role model
intends. Revisit once a real on-chain-role mirror exists (see Gap #1
below — the missing Wallet module — and Gap #3, rate limiting, both bear
on this).

**Final authoritative test count, confirmed by the user's own
`pnpm test` run**: **11/11 files, 120/120 tests passing** — env (3),
admin (17), analytics (5), audit (8), auth (17), candidate (11),
election (14), eventSync (22), ipfs (6), notification (7), voting (10).
This document's test counts have a demonstrated history of drifting from
the real per-file counts across earlier sessions (module-by-module
consolidation, added regression tests, etc.) — if a future session needs
an authoritative count, always trust a fresh real `pnpm test` run's own
per-file breakdown over any number written here.

**CORS**: `cors({ origin: env.FRONTEND_ORIGIN, credentials: true })` is
wired in `app.ts` (was previously a wide-open `cors()` with no options,
which silently breaks the credentialed SIWE-session cookie flow the
frontend needs). **CONFIRMED by the user's real test run** (the 120/120
count above already reflects this), committed and pushed to `main`
(`dfab3fa..16e3ed4`).

### Frontend (Phase 4) — scaffold slice DONE and verified; page content NOT started

Phase 4 was explicitly NOT started as a monolith — it's being built in
slices, each with its own short design doc + forked-decision approval,
same discipline as the backend gaps above. **This first slice is the
foundational layer only**: design tokens/theme system, routing,
Wagmi/RainbowKit provider setup, SIWE auth flow, wallet-connect
components. Every page under `frontend/src/pages/` is still a placeholder
— real page content (election list, voting UI, admin forms) is future
slices, deliberately deferred so this layer existed first for every page
to build on rather than each page reinventing wallet/theme/auth context.
See `PHASE4_SCAFFOLD_MANIFEST.md` at repo root for the full file-by-file
list; summarized here are the actual **design decisions**, since those
are durable and worth knowing without re-reading the whole manifest:

**Approved forked decisions (Phase 4 scaffold design doc):**
- **Local UI state (non-wallet, non-server): Zustand**, not React Context
  — currently used for exactly one thing, the theme store
  (`frontend/src/stores/themeStore.ts`). Wallet/chain state stays in
  Wagmi, server data in React Query — this store never grows to hold
  either.
- **Contract addresses: `shared/contract-addresses.json`** (per-chain,
  keyed by chain ID), not frontend-only `.env` vars — matches the
  `shared/abi/*.json` pattern the backend already established
  (`backend/src/modules/blockchain/contracts/ElectionContractClient.ts`'s
  own relative-reach-outside-package import). **Only the frontend side is
  wired** (`frontend/src/lib/contractAddresses.ts`) — `contracts/scripts/
  deploy.ts`/`verify.ts` do NOT yet write to this file. Flagged
  explicitly, not silently left half-done: that's a `contracts`-package
  change with its own already-tested surface and deserves its own design
  doc, not a drive-by edit during a frontend session.
- **Build sequencing:** scaffolding-first (routing/providers/auth), not a
  wallet-connect vertical slice — user's call, given the design-direction
  discussion (see below) needed resolving before any component styling
  made sense anyway.

**Design direction (dual-mode theme, not a forked decision in the
technical-tradeoff sense, but equally durable — future slices must stay
consistent with this, not re-litigate it):**
- **Light mode:** Stripe-like — paper surfaces (`#F7F8FA`/`#FFFFFF`),
  restrained indigo accent (`#4F46E5`), a soft diagonal hero-gradient wash
  reserved for the landing-page hero only, nowhere else.
- **Dark mode:** Snapshot/Etherscan-like — near-black chrome (`#0B0D10`),
  data-dense, disciplined, brighter accent for dark-surface contrast
  (`#6C6FF0`), deliberately NO hero gradient (stays quiet/data-dense
  throughout).
- **Both modes share the same token *roles*** (`bg`/`surface`/`border`/
  `ink`/`muted`/`accent`/`confirmed`/`pending`/`danger`), implemented as
  CSS custom properties under `:root`/`.dark` in `frontend/src/
  index.css`, consumed via Tailwind's `rgb(var(--x) / <alpha-value>)`
  pattern in `frontend/tailwind.config.js` — changing a color means
  editing exactly one line in `index.css`, never a scattered hex literal
  in a component.
- **`confirmed` (emerald) is reserved for on-chain-confirmed state only**
  (vote cast, election finalized, registration approved) — the accent
  color itself carries meaning, not decoration. `pending` (amber) is
  provisional/not-yet-confirmed. This convention MUST hold in every future
  page — a page using emerald for something that isn't an on-chain
  confirmation breaks the system's one real semantic promise.
- **Typography:** Fraunces (display/headlines only, never body) + Public
  Sans (body/UI — deliberately the U.S. federal design system's own
  typeface, a subject-grounded choice for a civic voting product) + IBM
  Plex Mono (`.font-chain-data` class — wallet addresses, tx hashes,
  block numbers, vote counts; functional, not decorative, used
  throughout, never regular body text for this kind of data).
- Full reasoning and the real reference sites discussed
  (tally.xyz, snapshot.org, etherscan.io, stripe.com, linear.app) are in
  this session's chat history, not repeated in a file — the token
  values above in `index.css`/`tailwind.config.js` are the actual source
  of truth going forward.

**Verification (real, not sandbox-approximated — frontend tooling has no
network restriction, unlike contracts/backend):** `pnpm install` ✅,
`npx tsc -b --noEmit` ✅ zero errors, `npx eslint .` ✅ zero errors,
`npx vitest run` ✅ **15/15 tests passing**, `npx vite build` ✅ real
production build (specifically confirms the `shared/contract-
addresses.json` cross-package import resolves under Vite's bundler, not
just under `tsc`'s type-checker). Not yet done: the user has not run
`pnpm --filter @dvs/frontend dev` and visually confirmed the design
renders as intended — no automated test substitutes for that, worth doing
before the next slice builds on top of it.

**Not yet done, called out explicitly:** `RoleGuard` (routes are not yet
gated by on-chain role — `frontend/src/router.tsx`'s own comment flags
this); real page content for 6 of 7 pages (Landing is now done — see
below); the `contracts/scripts` half of the contract-addresses decision.

### Frontend (Phase 4) — Landing page (election list) slice: DONE and verified

Second Phase 4 slice, built on top of the scaffold above. New:
`frontend/src/hooks/useElections.ts` (React Query wrapper around
`GET /elections`, 15s poll — user's call), `frontend/src/components/
ElectionCard.tsx`, `frontend/src/components/ElectionStateStrip.tsx` (the
scaffold's ledger-strip signature element, built for real here for the
first time), `frontend/src/pages/Landing.tsx` (rewritten).

**Approved decisions (this slice's design doc):**
- Cards grouped into sections by state, **Active-now first** (not
  alphabetical, not chronological) — a visitor's first question is "what
  can I vote in right now."
- **15s background poll**, matching the mirror's own lag characteristics
  (`RECOMMENDED_POLL_INTERVAL_MS` in `backend/src/modules/blockchain`) —
  this is "reasonably current," not a real-time-chain claim.
- **Draft elections are hidden from the public Landing page** (Claude's
  call, user deferred): `electionId === null` drafts are off-chain-only
  admin work-in-progress with no chain backing — showing them publicly
  would undercut the app's core promise (what you see is real, confirmed
  chain state). They'll surface in a future Admin Dashboard view instead,
  never here.

**A real backend scope gap surfaced building this:**
`ElectionLifecycleState` only has 5 values, not architecture.md Section
16's full 8 (Registration Open/Closed and Archived aren't computable
server-side yet — `election.types.ts`'s own header comment explains why).
`ElectionStateStrip.tsx` was built for the 4 non-draft states that
actually exist today, not the full spec — revisit this component's step
list when those backend gaps close, not before. This is the same kind of
document-drift the verification discipline above exists to catch; noting
it here rather than letting the frontend silently paper over it.

**Verification (real):** `npx tsc -b --noEmit` ✅, `npx eslint .` ✅,
`npx vitest run` ✅ **24/24 tests** across 6 files (this run caught a
real bug: RTL's automatic cleanup never registered itself because
`vite.config.ts` has `test.globals: false`, so DOM from one test in a
multi-render file was leaking into the next — fixed in
`frontend/src/test/setup.ts` with an explicit `afterEach(cleanup)` — a
genuine finding, not a formality), `npx vite build` ✅.

## Backend architecture gaps — ALL 7 CLOSED, kept below as historical record

These were surfaced by directly grepping/reading the backend source
against each relevant section of `architecture.md`, specifically because
this document has a demonstrated history of drift. **All seven were
worked through one by one, each as its own short design doc with forked
decisions approved before implementing, and all seven are now confirmed
by the user's own real `pnpm test` runs** (final count as of that point:
179/179 tests across 18 files - **superseded**, see "Newly discovered
pre-frontend items" below for the current 194/194-across-19-files count
after items 1/2/4 there were built and confirmed). Kept below, unedited,
as the historical record of what was found and how each was resolved —
a future session should NOT need to revisit any of these, only the new
items in the section right after this one.

## Newly discovered pre-frontend items — ALL 5 DONE and confirmed/complete

After the 7 gaps above were confirmed closed, the user asked to check for
anything else outstanding before Phase 4. This section is the result of
that check — a fresh pass over `architecture.md` Section 24 (the
project's own "production readiness" / final-approval checklist) and the
still-open TODOs this document had already flagged elsewhere (see
"Current project state" above), re-verified against the actual code
(`grep`/`find`, not assumption) as of this session. **None of these were
part of the 7 numbered gaps above and none have been discussed with the
user yet as their own design docs** — this is a discovery/audit pass
only, not implementation. Presented in the order a next session should
probably tackle them, with reasoning for that ordering, but the user gets
final say.

1. **DONE, CONFIRMED by the user's real `pnpm test` run.** Added
   `hasRole()` to both `IElectionContractClient`/
   `IVoterRegistryContractClient` (thin `readContract` wrappers), a
   `blockchain/roles.ts` with the `ELECTION_ADMINISTRATOR_ROLE`/
   `SYSTEM_ADMINISTRATOR_ROLE` hash constants, and a new `requireRole(role)`
   middleware (`auth.roles.middleware.ts`) checking **both** contracts and
   requiring the role on **at least one** (approved fork - tolerates the
   two contracts' role state drifting apart, since they're independently
   managed AccessControl instances per `deploy.ts`). Deliberately
   **not cached** (approved fork) - `requireAuth`'s own header comment
   already states the governing principle for on-chain facts like this
   one. Wired into all four flagged write endpoints:
   `POST /elections/draft`, `PATCH /elections/draft/:id/link-onchain`,
   `POST /admin/registration-requests/:id/approve|reject`,
   `PUT /elections/:id/candidates/:candidateId/profile`,
   `POST /ipfs/upload`. Investigating this closer than the original audit
   pass did turned up two things worth flagging: (a) all four endpoint
   groups are pure off-chain Mongo/IPFS writes with **zero** on-chain
   revert fallback - worse than this document's earlier "harmless
   because the tx still reverts" framing assumed; (b)
   `linkOnChainElement` in particular had no ownership check tying a
   draft to the admin who created it, so a non-admin could previously
   hijack *any* draft onto an arbitrary confirmed `electionId`. Tests:
   a new `test/auth/auth.roles.middleware.test.ts` (7 tests) plus
   403/OR-semantics cases added to `election.test.ts`, `candidate.test.ts`,
   `admin.test.ts` (which needed its first-ever fake contract clients,
   since the module previously made no live chain calls at all), and
   `ipfs.test.ts`.
   **One real bug found and fixed only once the user ran the real suite**
   (this sandbox's `fastdl.mongodb.org` restriction meant these suites
   could only be typechecked/linted here, never executed): the new
   `election.test.ts` OR-semantics test got a genuine 400 instead of 201.
   Root cause: `ElectionMetadataModel`'s `description` field was
   `required: true` (with a `default: ""`) - real MongoDB's validator was
   never actually exercised by any prior test with an all-fields-present
   body, but the new test's `description: ""` tripped it, since Mongoose's
   `required` was doing real work here despite the default. Fixed by the
   user: `required: false` on that field. Unrelated to on-chain-role logic
   itself - a pre-existing latent bug the new test coverage happened to
   surface, not something the role-enforcement work introduced.
2. **DONE, CONFIRMED by the user's real `pnpm test` run.** Admin's
   `RegistrationRequestSummary` gained a `voterDisplayName` field
   (`toDisplayName(voterAddress)`, resolved in `toSummary()`) for the
   registration-review queue - and, found missing during the same real
   test run, `POST /voters/register-request`'s hand-rolled response
   object (it builds its own plain object rather than going through
   `toSummary()`, so it didn't automatically pick up the new field) also
   now includes `voterDisplayName`, fixed by the user in
   `admin.routes.ts` for consistency between the two response shapes.
   Notifications' `ElectionFinalized` email/webhook now carry the
   finalizer's display name - `eventSync.ts` passes the event's own
   `finalizedBy` address through
   `enqueueElectionFinalizedNotifications`/`enqueueElectionFinalizedWebhooks`
   (both gained an optional third parameter), resolved once per call via
   `toDisplayName`, not once per recipient. Both integration points
   degrade to the checksummed address with zero behavior change when no
   `RPC_URL_MAINNET_ENS` is configured. New/updated tests in
   `admin.test.ts`, `notification.test.ts`, `webhook.test.ts`.
3. **DONE, CONFIRMED by a real GitHub Actions run** (2026-07-12) —
   `.github/workflows/ci.yml`, push to `main`, commit `453be08`: all five
   jobs green, total run 1m32s (`contracts` 30s, `contracts-slither` 49s,
   `backend-unit` 1m29s, `backend-integration` 38s, `frontend` 26s).
   Triggers: PRs targeting `main` and pushes to `main`; `concurrency`
   cancels superseded runs on the same ref. This session's original draft
   built and passed in-sandbox static checks (valid YAML, clean
   `actionlint`), but three things had to change once it actually ran on
   GitHub's runners — worth recording *why*, not just *that*, since the
   same traps would resurface if this workflow gets rewritten later:
   - **`crytic/slither-action@v0.4.2` got replaced with a plain
     `pip install slither-analyzer` + direct `slither .` CLI call** from
     `contracts/`, plus `actions/setup-python@v5`. The action-wrapped
     approach was this session's in-sandbox best guess (its inputs were
     confirmed to exist via web search, but the action itself was never
     actually run anywhere) — the direct-CLI approach is simpler, easier
     to debug when it fails, and is what actually got verified working.
     `--exclude timestamp,pragma` was added alongside the already-present
     `--exclude-dependencies`, suppressing two low-value/high-noise
     detectors (block-timestamp-as-randomness-source and floating-pragma
     warnings) rather than gating on a severity threshold.
   - **`backend-integration` needed a much larger explicit env block than
     this session's draft assumed**: `RESEND_API_KEY`, `RPC_URL_PRIMARY`/
     `RPC_URL_FALLBACK`, `CHAIN_ID`, dummy `CONTRACT_ADDRESS_*` and
     `BACKEND_SIGNER_PRIVATE_KEY` values, `IPFS_API_KEY`/`IPFS_API_SECRET`,
     `SIWE_DOMAIN`/`SIWE_SESSION_SECRET` — set directly as job step env,
     not left to `harness.ts`/the test file's own `Object.assign`. Reading
     the harness code in-sandbox undercounted `env.ts`'s real required
     surface (e.g. `RESEND_API_KEY` wasn't visible from the blockchain-
     module code path this session traced) — the real run is the more
     trustworthy source here, not the earlier static read. Worth knowing
     for future env.ts changes: this is now the actual list of what a
     from-scratch process needs before that module graph will load.
   - Node/pnpm bumped from the draft's `20`/`9` to `22`/`11` — no known
     compatibility reason surfaced, treat as the user's environment
     preference rather than a forced fix.
   - Branch protection itself (requiring these five job names before
     merge) remains a GitHub repo *setting*, not expressible in the
     workflow YAML, and is still an open manual step now that the job
     names exist for real: Settings → Branches → branch protection rule
     on `main` → require status checks → select all five.
4. **DONE, CONFIRMED by the user's real `pnpm test` run.** `/health`
   stays pure liveness (unchanged). `/ready` checks
   `mongoose.connection.readyState` and `getRedisConnection().status`
   (both already-maintained connection state, not a live round-trip on
   every request) and returns 503 with a `checks` breakdown when either
   is down. `/metrics` is hand-rolled Prometheus text-exposition format
   (uptime, RSS, heap used/total, an `up` gauge) straight off `process` -
   deliberately **no new dependency** (no `prom-client`) for a handful of
   numbers at this project's scale; worth revisiting with a real metrics
   library if/when this app needs histograms or custom business metrics.
   New `test/config/health.test.ts` (3 tests) covers all three endpoints,
   including `/ready`'s 503 path.
5. **DONE this session (2026-07-12).** Added the 4 missing diagrams to
   `architecture.md` Section 3.1, same ASCII-swimlane style as the
   original two: **Create Election** (off-chain `POST /elections/draft` →
   admin wallet signs `createElection()` directly, never via backend →
   worker mirrors `ElectionCreated` → `PATCH .../link-onchain` does a
   *live* `client.getElection()` read to verify before linking — traced
   from `election.routes.ts`/`election.service.ts`, not guessed),
   **Register Voter** (the off-chain application queue this section's
   pre-existing "admin approves registration" diagram assumes as its
   starting point — `RegistrationRequestModel`'s pending/approved/rejected
   workflow, traced from `admin.routes.ts`/`admin.model.ts`/
   `admin.types.ts`), **Event Processing** (the generic `pollOnce()` →
   `syncAllEvents()` → idempotent-upsert-keyed-on-`{txHash,logIndex}` →
   BullMQ-enqueue → checkpoint-only-advances-after-success pipeline every
   other diagram's "Background Worker: upsert" step actually goes through
   — traced from `worker/worker.ts` and `eventSync.ts`'s real control
   flow, including the genuinely-verified "10 tracked event definitions"
   count), and **Finalize Election** (admin wallet signs
   `finalizeElection()` per ADR-006 — never inferred from `endTime` —
   worker mirrors `ElectionFinalized`, enqueues notifications/webhooks/
   rollup recompute, `election.service.ts`'s lifecycle derivation flips to
   `"result_finalized"` for every client immediately off Mongo, traced
   from `Election.sol`, not assumed). The "Additional refinement"
   section's promise bullet is updated to reflect this. Documentation-
   only, zero runtime impact — nothing to verify with a test run, only
   with a careful re-read against the real routes/contract/worker code,
   which is what this entry records happening.

**Items 1, 2, and 4 are DONE and CONFIRMED as of this session (2026-07-12)**
— the user explicitly chose "address all 5 now" over deferring to Phase 4,
3 of the 5 got built, and the user then ran the real `pnpm test` suite
themselves (this sandbox's `fastdl.mongodb.org` restriction meant the
Mongo-backed suites could only be typechecked/linted in-session, never
executed here). That real run caught two genuine bugs the in-sandbox
verification couldn't have: `ElectionMetadataModel.description`'s
`required: true` rejecting an empty-string body the new role-enforcement
test exercised (fixed: `required: false`), and `POST
/voters/register-request`'s hand-rolled response object missing the new
`voterDisplayName` field that `toSummary()`-based responses picked up
automatically (fixed: added it there too, in `admin.routes.ts`). Both
fixes applied by the user directly, then synced back into this repo.
**Final confirmed count: 19/19 test files, 194/194 tests passing** — a
genuinely trustworthy number, not an in-sandbox approximation. `tsc
--noEmit` and `eslint .` both clean throughout.

**Item 3 (CI pipeline): DONE, CONFIRMED by a real GitHub Actions run this
session (2026-07-12) — all five jobs green, see its full entry above for
what changed between the in-sandbox draft and the real, working version.
Item 5 (4 sequence diagrams): also DONE this session** — added to
`architecture.md` Section 3.1, see its full entry above for what each
diagram is sourced from. **All 5 pre-frontend items are now closed.**



1. **Wallet module doesn't exist.** ~~Section 7.1 lists `Wallet`~~
   **STATUS: DONE, pending the user's own `pnpm test` confirmation (see
   below) — this session's in-sandbox network restrictions couldn't run
   it.** Built `backend/src/modules/wallet/` (`wallet.service.ts`,
   `wallet.provider.ts`, `wallet.cache.ts`, `wallet.types.ts`, `index.ts`)
   plus `backend/test/wallet/wallet.test.ts` (19 tests) and
   `wallet.provider.configured.test.ts` (2 tests, isolated in its own file
   — see its header comment for why). **Approved forked decisions** (all
   three confirmed by the user before implementing):
   - ENS resolution uses a **dedicated mainnet-only viem client**
     (`RPC_URL_MAINNET_ENS`, new optional env var in `env.ts`), not the
     existing Sepolia/Hardhat client from the Blockchain module — real ENS
     names live on mainnet; Hardhat has no ENS contracts at all and
     Sepolia's ENS deployment is a sparse test registry.
   - **Internal-only in this pass** — no `wallet.routes.ts`, nothing
     wired into `app.ts`. Section 7.3's endpoint list doesn't call for a
     public Wallet endpoint, and adding one unguarded ahead of rate
     limiting (gap #3, still open) would be a new abuse surface with no
     approved use case yet. Exports `isValidAddress`, `toChecksumAddress`
     (throws `HttpError(400, INVALID_ADDRESS)` on malformed input),
     `resolveEnsName`, `resolveAddressFromEnsName`, `toDisplayName` — all
     four resolution functions degrade to `null`/the raw address on any
     failure (missing RPC config, network error, whatever) rather than
     throwing; only `toChecksumAddress` throws, since address-format
     validity is real input validation, not a display nicety.
   - **Cached now**: a dependency-free in-memory TTL cache
     (`wallet.cache.ts`, 1-hour TTL), scoped to this module rather than a
     shared utility — not a substitute for rate limiting (caches by
     lookup key, doesn't bound distinct-lookup volume).
   - **Not yet done, flagged as natural follow-on, not scope creep into
     this gap**: nothing in Admin/Notifications actually calls
     `toDisplayName`/`resolveEnsName` yet. The module is ready to be
     consumed but wiring it into those modules' existing tested code
     wasn't part of what gap #1 asked for and wasn't approved separately.
   - Verified in-sandbox: `tsc --noEmit` clean for every wallet file,
     `npx vitest run test/wallet/` → 21/21 passing (both files). Full
     `npx vitest run` also run — the 10 other suites (admin, analytics,
     audit, auth, candidate, election, eventSync, ipfs, notification,
     voting) failed only on the already-documented `fastdl.mongodb.org`
     sandbox restriction above, not on anything wallet-related; env.test.ts
     and both wallet test files (the only three that don't need Mongo)
     passed clean. **CONFIRMED by the user's real `pnpm test` run** (see
     gap #3's entry below for the final 147/147 figure, which
     supersedes this one).
   - Found and fixed two real bugs during testing (see git-free diff in
     `wallet.service.ts`/its test file if useful context for a future
     session): (1) the "ENS resolution never throws" contract had
     originally only been enforced inside the concrete viem-backed
     `IEnsClient`, not at the `resolveEnsName`/`resolveAddressFromEnsName`
     call sites — meant any *other* `IEnsClient` (including test fakes)
     that threw would break the contract; moved the guard to the call
     sites. (2) `env.ts` parses `process.env` into a frozen singleton at
     first import — a test that mutated `process.env.RPC_URL_MAINNET_ENS`
     *after* an already-cached import silently did nothing; fixed by
     isolating that case in its own test file with its own fresh module
     registry, per this project's existing `env.test.ts` pattern.
2. **`GET /api-docs` (Swagger/OpenAPI) is not wired up.** **STATUS: DONE,
   pending the user's own `pnpm test` confirmation (see below) — this
   session's in-sandbox network restrictions couldn't run the
   Mongo-dependent suites.** Built `backend/src/config/swagger.ts`
   (`buildOpenApiSpec()`, wraps `swagger-jsdoc` reading every route
   file's existing `@openapi` JSDoc), wired into `app.ts` as
   `GET /api-docs` (Swagger UI) and `GET /api-docs.json` (raw spec),
   plus `backend/test/config/swagger.test.ts` (3 tests). **Approved
   forked decisions** (confirmed by the user before implementing):
   - **Dev/test only, never production.** Both routes are gated by
     `if (env.NODE_ENV !== "production")` in `app.ts` — genuinely
     absent (404) in production, not just hidden/empty, so there's no
     ambiguity about whether it's "on" from the outside.
   - **Both a UI and a raw JSON endpoint** — `/api-docs` (Swagger UI)
     and `/api-docs.json` (raw spec, e.g. for Postman/codegen import),
     both behind the same production gate.
   - **`swagger-jsdoc`'s `apis` glob points at TypeScript source**
     (`src/modules/**/*.routes.ts`), not compiled `dist/`. Confirmed
     safe only because `package.json`'s `dev:api`/`test` scripts run
     via `tsx`/`vitest` directly against `.ts` source, while
     `start:api` (`node dist/app.js`, the actual production entrypoint)
     never reaches this code path at all — the production gate above
     and this glob choice are a matched pair. If a future session ever
     needs `/api-docs` reachable from a compiled `dist/app.js` run,
     both decisions need revisiting together.
   - Verified in-sandbox: `tsc --noEmit` clean, `eslint .` 0 errors,
     `npx vitest run test/config/swagger.test.ts test/wallet/
     test/env.test.ts` → 27/27 passing. **CONFIRMED by the user's real
     `pnpm test` run: 15/15 files, 150/150 tests passing.** Gap #2 is
     fully done, not just in-sandbox-verified.
   - **Note for future sessions**: the first delivery of this gap's
     `app.ts` changes silently failed to apply on the user's machine -
     the file that landed on disk was byte-for-byte the pre-change
     version (confirmed via `grep -n "api-docs" src/app.ts` returning
     zero matches), even though `swagger.ts` and the new test file both
     applied correctly. Root cause was a one-off copy/paste miss, not a
     code or tooling bug - but it's worth remembering that "user reports
     a failure that looks like a code bug" should prompt asking for the
     actual on-disk file content (`cat -n`) before assuming the
     delivered code is wrong, same lesson as the concurrent-AI-agent
     entry above. The 404s in that failed run were completely genuine
     (Express's own no-route-matched handler, not a thrown error) -
     `buildApp()` itself booted fine, it just had no route registered
     for `/api-docs*` because that code was never actually present.
   - **Deliberately not separately tested in-process**: the
     `NODE_ENV=production` gate (docs absent). `app.ts`'s own
     module-level guard (`if (env.NODE_ENV !== "test") { bootstrap()... }`)
     would fire a real `connectDatabase()`/`app.listen()` the instant
     `app.ts` is imported with `NODE_ENV=production` — unsafe to trigger
     from a test file and outside what this test was trying to verify.
     The gate itself is a single trivial conditional around two route
     mounts — reviewed, not separately covered by an automated test.
3. **No rate limiting.** ~~Section 7.1 lists it~~ **STATUS: DONE, fully
   confirmed** (see below). Built
   `backend/src/middleware/rateLimiter.ts` (`generalWriteLimiter`,
   mounted globally in `app.ts`; `authNonceOrSiweLimiter`, mounted
   directly on `POST /auth/nonce` and `POST /auth/siwe` in
   `auth.routes.ts`) plus `backend/test/middleware/rateLimiter.test.ts`
   (6 tests). Added `rate-limiter-flexible` dependency. **Approved forked
   decisions** (all three confirmed by the user before implementing):
   - **Library**: `rate-limiter-flexible` (not `express-rate-limit`) -
     the user's explicit call over the more Express-idiomatic default.
   - **Store**: the existing shared Redis connection
     (`shared/redis.ts`'s `getRedisConnection()`), not a new in-memory
     store - correct if this API is ever horizontally scaled, costs
     nothing new since Redis is already mandatory infra (BullMQ).
   - **`app.set("trust proxy", 1)`** added in `app.ts` - confirmed this
     deployment sits behind exactly one reverse proxy. `req.ip` is the
     rate-limiting key; without this setting it would be either wrong
     (every request sharing the proxy's IP) or spoofable (trusting every
     hop of X-Forwarded-For).
   - **Scope**: two tiers - a general limiter on
     `POST`/`PUT`/`PATCH`/`DELETE` globally (Section 24's literal "public
     write endpoints"), plus a stricter limiter specifically on
     `/auth/nonce` and `/auth/siwe` (the only two endpoints reachable
     with zero authentication at all). `/auth/logout` deliberately
     excluded from the stricter tier (idempotent, low-value target - same
     reasoning as its own route's "why no requireAuth" comment).
   - **A real problem found and fixed mid-implementation, not anticipated
     by the design doc**: every other domain module touching BullMQ
     (Analytics, Notifications) defines a minimal `IJobQueue` interface
     and injects a fake test double specifically so its OWN tests never
     open a real Redis connection (see those modules' own header
     comments). Mounting a Redis-backed limiter globally would have
     silently broken that convention for every other domain module's
     EXISTING tests (admin, candidate, election, ipfs, notifications,
     auth) the moment they hit any write route - none of those test
     files know anything about rate limiting. Fixed with the same
     pattern this codebase always uses for this exact problem: a minimal
     `IRateLimiter` interface (real `RedisRateLimiter` vs. injectable
     fakes), plus defaulting to a no-op limiter automatically when
     `env.NODE_ENV === "test"` - same "don't do the real thing during
     tests unless told to" philosophy as `app.ts`'s own
     `if (env.NODE_ENV !== "test")` bootstrap guard. **This means the
     other 8 write-touching test files need NO changes at all** - they
     get the no-op by default, exactly like before this gap existed.
   - Verified in-sandbox: `tsc --noEmit` clean, `npx vitest run
     test/middleware/ test/wallet/ test/env.test.ts` → 30/30 passing.
     Could NOT verify in-sandbox that the other 8 suites (admin,
     analytics, audit, auth, candidate, election, eventSync, ipfs,
     notification, voting) still pass unchanged - they all need
     `mongodb-memory-server`, blocked by the already-documented
     `fastdl.mongodb.org` sandbox restriction. **CONFIRMED by the user's
     real `pnpm test` run on their own machine: 14/14 files, 147/147
     tests passing.** The global `generalWriteLimiter` mount did not
     disturb any existing write-route test, confirming both gap #1 and
     gap #3 are fully done, not just in-sandbox-verified.
   - **Note for future sessions**: on a genuinely fresh machine (empty
     `~/.cache/mongodb-binaries/`), running `pnpm test` for the very
     first time can transiently fail 2 suites with `Cannot unlock file
     "...7.0.24.lock", because it is not locked by this process` - this
     is Vitest's parallel file execution racing multiple suites'
     `MongoMemoryServer.create()` calls against the same cold binary
     download, not a code regression. Fix: run one Mongo-dependent test
     file alone first (e.g. `npx vitest run test/candidate/candidate.test.ts`)
     to warm the cache serially, then re-run `pnpm test` normally -
     confirmed this resolves it (14/14, 147/147 on the second run).
     Consider `--no-file-parallelism` or a `pretest` cache-warm step if
     this needs to be permanently robust for CI/fresh-clone use, but
     that's optional polish, not a correctness bug.
4. **Notifications are email-only, no webhook dispatch.** ~~Section 7.1
   specifies "email/webhook dispatch." Only `ConsoleNotificationSender`
   and `ResendNotificationSender` exist (both email) — no webhook sender.~~
   **STATUS: DONE, pending the user's own `pnpm test` confirmation (see
   below) — this session's in-sandbox network restrictions couldn't run
   the Mongo-dependent suite.** Built a full second dispatch channel,
   deliberately kept independent of the email channel end to end (own
   model, own queue, own worker — see each new file's header comment for
   the specific reasoning): `webhookPreference.model.ts`,
   `IWebhookSender.ts`, `HttpWebhookSender.ts` (concrete sender, signed
   HTTP POST via `fetch`, no new dependency), `webhook.queue.ts`
   (dedicated BullMQ queue), `webhook.worker.ts` (dedicated BullMQ
   worker, started from `worker/worker.ts` alongside the other two).
   Wired a new route (`POST /elections/:id/notifications/webhook-subscribe`)
   and two new service functions (`subscribeToElectionWebhook`,
   `enqueueElectionFinalizedWebhooks`, the latter called from
   `eventSync.ts`'s `ElectionFinalized` handling right alongside the
   existing email dispatch call). Test file:
   `backend/test/notification/webhook.test.ts` (8 tests), mirroring
   `notification.test.ts`'s structure. **Approved forked decisions** (all
   three confirmed by the user before implementing):
   - **Separate subscription, separate model** — `WebhookPreferenceModel`
     is its own collection, not an optional `webhookUrl` column bolted
     onto `NotificationPreferenceModel`. A webhook subscription carries a
     secret that must never round-trip back out except in the
     subscribe-response body itself; keeping it in a dedicated model
     makes "don't leak the secret" structurally scoped to the one place
     that touches it, rather than a rule every future
     `NotificationPreferenceModel` reader/writer has to remember.
   - **Signed payloads** — Stripe/GitHub-style timestamped HMAC-SHA256,
     not a bare signature over the body. `X-Webhook-Timestamp` (ms epoch)
     and `X-Webhook-Signature: sha256=<hex HMAC of
     "${timestamp}.${body}">`, using a per-subscription secret generated
     server-side (`node:crypto`'s `randomBytes(32)`) at subscribe time —
     never client-supplied. The secret is returned to the caller exactly
     once, in the subscribe response; re-subscribing (same election +
     wallet) rotates it to a fresh value. This class does not itself
     enforce a replay window on the timestamp — that's the receiver's own
     concern, same as any real webhook provider's docs would say.
   - **Dedicated queue/worker** — `webhook-dispatch` is its own BullMQ
     queue and `Worker`, not a discriminated-union job type folded into
     the existing `notification-dispatch` queue. An unreachable or slow
     third-party endpoint retrying with its own backoff must never share
     retry/concurrency/backpressure with email delivery, whose failure
     modes (a Resend API error) are unrelated.
   - **Known, explicitly out-of-scope limitation** (flagged in
     `HttpWebhookSender.ts`'s own header comment, not silently assumed
     away): no SSRF hardening on the subscriber-supplied URL (e.g.
     rejecting internal/private IP ranges). Validated only as a
     well-formed URL (`zod .url()`), same validation depth as the email
     channel's `.email()`. Worth a future security-hardening pass if this
     ever accepts subscriptions from untrusted third parties at scale.
   - Verified in-sandbox: `tsc --noEmit` clean, `eslint .` 0 errors,
     `npx vitest run` → the 6 suites that don't need
     `mongodb-memory-server` all still pass, 42/42, unchanged from gap
     #5's confirmed baseline (`webhook.test.ts` itself needs Mongo, so
     it's in the same documented `fastdl.mongodb.org`-blocked bucket as
     `notification.test.ts` — couldn't be run at all in-sandbox, not just
     partially). **CONFIRMED by the user's real `pnpm test` run: 17/17
     files, 167/167 tests passing** — every one of the prior 16 files'
     counts unchanged, `test/notification/webhook.test.ts` at 8/8 as
     predicted. Gap #4 is fully done, not just in-sandbox-verified.
5. **No stalled-worker CRITICAL alert.** ~~Section 17's own severity table
   cites *"Worker has not processed a new block in 10 minutes"* as the
   canonical CRITICAL-level example — nothing in `eventSync.ts`/
   `worker.ts` actually detects or logs that condition today.~~ **STATUS:
   DONE, pending the user's own `pnpm test` confirmation (see below) —
   this session's in-sandbox network restrictions couldn't run the
   Mongo-dependent suites.** Built
   `backend/src/modules/indexing/stallDetector.ts` (pure state machine,
   `evaluateStall`/`initialStallDetectorState`, zero Mongo/pino
   dependency) plus `backend/test/indexing/stallDetector.test.ts` (9
   tests), and wired a thin I/O wrapper (`checkForWorkerStall()`) into
   `backend/worker/worker.ts`'s existing `pollOnce()` — runs after every
   poll attempt, success or failure. **Approved forked decisions** (all
   three confirmed by the user before implementing):
   - **Current-block source**: reuses the checkpoint data
     `eventSync.ts`'s `saveCheckpoint()` already writes to
     `WorkerCheckpointModel` every cycle (`MAX(lastProcessedBlock)` across
     all event rows), rather than a dedicated extra
     `client.getBlockNumber()` call. The MAX (not e.g. the MIN or any
     single event's row) is deliberate: `syncAllEvents()` isolates each
     event definition's failures from the others, so one event type
     erroring must not by itself make the whole worker look stalled while
     every other event type is still keeping up fine.
   - **Emission mechanism**: `"fatal"` added to `LOG_LEVEL`'s zod enum in
     `env.ts`, log emitted via pino's own built-in `.fatal()` (one level
     above `.error()`) — not a `severity: "CRITICAL"` field bolted onto
     `.error()`. First use of `.fatal()` anywhere in this codebase.
   - **Threshold**: new `WORKER_STALL_CRITICAL_MS` env var (default
     `600_000`, i.e. 10 minutes, matching Section 17's own example
     exactly), not a hardcoded constant — added to `env.ts`'s existing
     "Worker config (Phase 6, Section 8)" section and documented in
     `.env.example`.
   - **Not separately asked, applied as a small implementation default**:
     the alert fires once per stall episode (not once per poll cycle
     while still stalled — that would spam the log every
     `RECOMMENDED_POLL_INTERVAL_MS`), and logs a one-time `info`-level
     recovery message when the checkpoint advances again afterward. Both
     behaviors are covered by `stallDetector.test.ts`; flag if a
     different repeat/throttle policy is wanted instead.
   - Verified in-sandbox: `tsc --noEmit` clean, `eslint .` 0 errors,
     `npx vitest run` → the 6 suites that don't need
     `mongodb-memory-server` (env, middleware/rateLimiter,
     config/swagger, wallet/wallet.provider.configured,
     indexing/stallDetector — 9/9 passing) all green, 42/42 tests. The
     other 10 suites failed only on the already-documented
     `fastdl.mongodb.org` sandbox restriction, nothing new. **CONFIRMED
     by the user's real `pnpm test` run: 16/16 files, 159/159 tests
     passing** — every one of the prior 15 files' counts unchanged,
     `test/indexing/stallDetector.test.ts` at 9/9 as predicted. Gap #5 is
     fully done, not just in-sandbox-verified.
6. **Analytics trigger mechanism deviates from the doc.** **STATUS: DONE,
   pending the user's own `pnpm test` confirmation** — this session's
   in-sandbox network restrictions couldn't run the Mongo-dependent
   `analytics.test.ts` suite (same `fastdl.mongodb.org` restriction
   documented above). This gap turned out smaller than it first looked:
   the direct-enqueue mechanism (`eventSync.ts` calling
   `enqueueRollupRecompute` directly instead of a MongoDB Change Streams
   watcher) was **already implemented and already approved** in an
   earlier session — `analytics.model.ts`'s header comment already
   contained the full rationale, just never promoted to a numbered ADR
   file the way `ADR-001` through `ADR-006` were. No code logic changed
   for this gap — only documentation:
   - Added `docs/architecture/ADR/ADR-007-analytics-trigger-direct-enqueue.md`,
     following the existing ADR template (Status/Context/Decision/
     Rationale/Alternatives Considered/Consequences), explicitly noting
     it supersedes the Change-Streams-specific portion of
     `decisions-log.md` row #10.
   - **Approved forked decision**: also updated `architecture.md`
     (Section 8's worker-responsibilities bullet, the phase-summary
     table's Background Worker row, and the final-approval-list item #9)
     and `decisions-log.md` (row #10) to describe the actual,
     ADR-007-approved mechanism, rather than leaving them stating the
     superseded Change-Streams wording as still-current fact. The
     alternative (leave those files as unedited historical record, ADR
     as the sole override) was offered and not chosen.
   - Updated `analytics.model.ts`'s and `analytics.queue.ts`'s inline
     comments to point at the new ADR-007 file instead of each claiming
     to itself be "the ADR" — avoids two competing sources of truth for
     the same rationale.
   - Verified in-sandbox: `tsc --noEmit` clean, `eslint .` 0 errors (only
     comments/docs changed, no executable logic touched). **CONFIRMED by
     the user's real `pnpm test` run: 15/15 files, 150/150 tests
     passing** — unchanged from the prior confirmed count, exactly as
     expected since no test file or logic was added/modified by this
     gap. Gap #6 is fully done, not just in-sandbox-verified.
7. **Election-start reminder notification not built.** ~~Needs a
   wall-clock/cron trigger this codebase doesn't have anywhere yet
   (everything here reacts to chain events or HTTP requests, nothing
   runs on a schedule). Smaller than the other six; fold into whichever
   session is most convenient.~~ **STATUS: DONE, pending the user's own
   `pnpm test` confirmation (see below) — this session's in-sandbox
   network restrictions couldn't run the Mongo-dependent suite.** Built
   the first wall-clock-scheduled trigger in this codebase:
   `electionStartScan.queue.ts` (a BullMQ *repeatable* job, registered
   once at bootstrap, distinct in kind from every other queue here — it
   has no single recipient/trigger, it reads Mongo on its own schedule)
   and `electionStartScan.worker.ts` (`runElectionStartScan`, the actual
   scan: queries `IndexedElectionModel` by wall-clock time against
   `startTime`/`endTime`, dispatches through the *existing* email/webhook
   delivery queues from gap #4). Added a dedicated opt-in route
   (`POST /elections/:id/notifications/start-reminder-subscribe`) and one
   new service function (`subscribeToElectionStartReminders`) plus four
   new dispatch functions (`enqueueElectionStartingSoonNotifications`/
   `Webhooks`, `enqueueVotingOpenNotifications`/`Webhooks`), mirroring the
   existing finalized-notification pair exactly. Test file:
   `backend/test/notification/electionStartReminder.test.ts` (12 tests).
   **Approved forked decisions** (all three confirmed by the user before
   implementing):
   - **Fires on both**: an advance "starting soon" reminder (configurable
     lead time before `startTime`) AND a separate "voting is now open"
     notice (fired once `startTime` has passed but before `endTime`) —
     two independently-dedup'd events, not one.
   - **BullMQ repeatable job**, not a bare `setInterval` in `worker.ts` —
     reuses the same Redis-backed queue infrastructure gaps #4/#6 already
     established (Section 8-consistent), rather than a fifth ad hoc
     timing mechanism.
   - **Separate, dedicated opt-in** (`wantsStartReminders`, a new boolean
     field added to *both existing* preference models —
     `NotificationPreferenceModel` and `WebhookPreferenceModel` — default
     `false`) rather than reusing the plain existence of a finalization
     subscription as implicit consent. Unlike gap #4's webhook/email
     split (a different delivery *mechanism* entirely, hence a wholly
     separate model), this is the same delivery mechanism and recipient
     identity, just an additional lifecycle *event type* to opt into — so
     it's a field on the same document, not a new collection. The new
     endpoint only flips this flag on an *already-existing* row (email
     and/or webhook, whichever the caller has) — it returns 404
     `NOT_SUBSCRIBED` if the caller has subscribed to neither channel yet
     for that election, and never rotates the webhook signing secret.
   - **New config, following gap #5's established precedent** (not
     separately re-asked): `ELECTION_START_SCAN_INTERVAL_MS` (how often
     the scan runs, default 5 min) and
     `ELECTION_START_REMINDER_LEAD_TIME_MS` (how far before `startTime`
     the "starting soon" reminder fires, default 1 hour) — both new
     configurable env vars in `env.ts`/`.env.example`, same
     "operational threshold, not a fixed protocol constant" reasoning
     that justified `WORKER_STALL_CRITICAL_MS`.
   - **Dedup discipline, explicitly flagged as a known limitation**:
     `startReminderSentAt`/`votingOpenNotifiedAt` on `IndexedElectionModel`
     are read-then-written, not atomic — safe today because ADR-002 means
     exactly one worker process ever runs this, but
     `electionStartScan.worker.ts`'s own header comment flags the exact
     fix (`findOneAndUpdate` with the null-check baked into the filter)
     needed if that single-worker-process assumption ever changes.
   - Verified in-sandbox: `tsc --noEmit` clean, `eslint .` 0 errors,
     `npx vitest run` → the 6 suites that don't need
     `mongodb-memory-server` all still pass, 42/42, unchanged from gap
     #4's confirmed baseline (`electionStartReminder.test.ts` itself
     needs Mongo, so it's in the same documented
     `fastdl.mongodb.org`-blocked bucket as every other DB-backed suite —
     couldn't be run at all in-sandbox). **CONFIRMED by the user's real
     `pnpm test` run: 18/18 files, 179/179 tests passing** — every one of
     the prior 17 files' counts unchanged,
     `test/notification/electionStartReminder.test.ts` at 12/12 as
     predicted. Gap #7 is fully done, not just in-sandbox-verified.
     **All seven backend architecture gaps are now closed.**

## Next steps

1. Re-establish the verification discipline above explicitly at the start
   of any new session.
2. **Confirm no other AI agent is concurrently editing this working
   tree** before making any changes — see the "Non-obvious lessons" entry
   above for why this matters concretely, not just in the abstract.
3. **All seven backend architecture gaps, PLUS items 1/2/4 of the "newly
   discovered pre-frontend items" below, are DONE and CONFIRMED** by the
   user's real `pnpm test` run this session (2026-07-12): **19/19 test
   files, 194/194 tests passing.** That run caught two real bugs (see
   items 1/2's entries below for exactly what and why) that this
   session's in-sandbox-only verification couldn't have - trust this
   194/194 number, not any in-sandbox approximation quoted earlier in
   this document's history.
4. **Item 3 (CI pipeline) is DONE and CONFIRMED** by a real green
   GitHub Actions run (all five jobs, commit `453be08`) — see its entry
   above for the three things that had to change between this session's
   in-sandbox draft and the real, working version, worth knowing if this
   workflow gets touched again. **Item 5 (4 sequence diagrams) is also
   DONE** this session — see its entry above for what each new diagram
   traces back to in the real routes/contracts/worker code. **All 5
   pre-frontend items are now closed.**
5. **Remaining manual step for item 3**: branch protection itself
   (requiring these five job names before merge) is a GitHub repo
   *setting*, not expressible in the workflow YAML — enable it under
   Settings → Branches → branch protection rule on `main` → require
   status checks → select all five job names, now that they exist for
   real.
6. **Phase 4 (Frontend) scaffold slice is DONE and verified** (2026-07-12
   session) — design tokens/dual-mode theme, routing, Wagmi/RainbowKit,
   SIWE auth flow, wallet-connect components. Real `tsc`/`eslint`/
   `vitest` (15/15)/`vite build` all passed. See the Frontend section
   above for the full design-decision record and what's explicitly NOT
   done yet (RoleGuard, real page content, `contracts/scripts` half of
   the contract-addresses decision).
7. **Landing page (election list) slice is DONE and verified**
   (2026-07-13 session) — grouped-by-state cards, 15s poll, drafts hidden
   from public view, ledger-strip built for real for the first time. Real
   `tsc`/`eslint`/`vitest` (24/24)/`vite build` all passed; the test run
   caught a genuine RTL-cleanup bug (see Frontend section above). Also
   surfaced a real backend scope gap worth remembering: the lifecycle
   state enum only has 5 values, not Section 16's full 8 — see that
   section's entry for exactly why.
8. **Election Detail page slice is DONE and verified** (2026-07-13
   session) — candidates, registration-gated ballot, hidden-until-ended
   results, and the first real use of the direct-to-chain write path
   (`vote()`, wallet-direct per architecture Section 8/9 and
   `voting.types.ts`'s own header comment — no backend relay exists for
   it). New: `frontend/src/hooks/useElection.ts`, `useCandidates.ts`,
   `useElectionResults.ts`, `useHasVoted.ts`, `useRegistrationStatus.ts`,
   `useCastVote.ts`; `frontend/src/components/CandidateCard.tsx`,
   `BallotForm.tsx`, `ResultsBar.tsx`, `RegistrationGate.tsx`;
   `frontend/src/pages/ElectionDetail.tsx` rewritten.

   **A real backend API inconsistency was found and worked around, not
   silently patched over:** `GET /elections/:id` (`election.routes.ts`)
   is keyed on the Mongo draft id, but `/elections/:id/candidates`,
   `/results`, and `/has-voted` are all keyed on the on-chain numeric
   `electionId` instead — two different ID spaces sharing the same `:id`
   param name across route files. Resolved by keeping the URL on the
   Mongo id (no backend change, matches `ElectionCard`'s existing link)
   and reading `.electionId` off the fetched summary to drive the other
   three calls — see `useElection.ts`'s header comment. `router.tsx`'s
   route param was also renamed `:electionId` → `:id` to stop implying
   it was the on-chain id.

   **The real eligibility gate is `onChainConfirmed`, not `status`:**
   `admin.types.ts`'s own comment explains these two fields are
   deliberately independent (an admin can mark a request "approved" in
   the review queue without having submitted, or without the worker
   having yet indexed, the actual `registerVoter()` transaction).
   `RegistrationGate.tsx` gates on `onChainConfirmed` — a `status:
   "approved"` with `onChainConfirmed: false` correctly still shows a
   "waiting for on-chain confirmation" notice, not a ballot. Covered by
   `RegistrationGate.test.tsx`.

   **Approved decisions (this slice's design doc):** results hidden
   until `voting_ended`/`result_finalized` (avoids bandwagon effects,
   user's call — a UX choice, not a security boundary, since the
   endpoint itself is public); vote success is reported only after
   `useWaitForTransactionReceipt` resolves, not on tx-hash-returned
   (consistent with the scaffold's "confirmed" token meaning genuinely
   on-chain-confirmed); the registration-request flow is built inline on
   this page (no separate Voter Dashboard needed for it).

   **Verification (real):** `npx tsc -b --noEmit` ✅, `npx eslint .` ✅,
   `npx vitest run` ✅ **41/41 tests** across 10 files — this run caught
   a second genuine bug, distinct from the RTL-cleanup one: wagmi's
   `useAccount` export is non-configurable, so `vi.spyOn(wagmi,
   "useAccount")` throws `Cannot redefine property` at runtime (not a
   type error — `tsc` was clean). Fixed by `vi.mock("wagmi", ...)`
   instead of spying on the module namespace — see
   `RegistrationGate.test.tsx`'s header comment, worth knowing before any
   future test needs to control wallet state. `npx vite build` ✅.

   **Not done, called out explicitly:** the Voter Dashboard page
   (`/dashboard`) still shows its own placeholder — it was never the
   target of this slice; "inline registration flow" above just means
   this page doesn't *require* that dashboard to exist yet, not that the
   dashboard itself was built.
9. **Next slice candidates:** Voter Dashboard (eligibility/vote history
   across elections — largely reuses hooks already built this session),
   or Admin Dashboard + Create Election + Registration Requests (all
   currently placeholders, all admin-role-gated — this is also where
   `RoleGuard` finally needs to get built, since it's the first place
   ungated access would actually matter). Get a short design doc first,
   same discipline as always.
10. **New backend endpoint: `GET /voters/me/elections`** (2026-07-13
    session, for the Voter Dashboard slice below). `admin.service.ts`'s
    new `getMyElectionStatuses()` is **the first function in this
    backend that imports another domain module's service directly**
    (`election.service.listElections`, `voting.service.hasVoted`) —
    every prior cross-module dependency in this codebase was a
    shared-infra import (`blockchain`/`wallet`/`audit`), never one domain
    module reaching into another. **User's explicit, approved call**:
    accept this coupling and reuse the already-tested logic in each
    module, rather than duplicating election-listing/`hasVoted` reads
    inside the admin module to preserve the prior independence. Returns
    only elections the wallet has SOME relationship with (a registration
    request exists, OR the mirror confirms on-chain registration, OR the
    wallet has voted) — a personal dashboard, not Landing's full list
    annotated. Does one live `hasVoted()` contract read per non-draft
    election (batched with `Promise.all`, not one round-trip per
    election the way an equivalent frontend-side fan-out — the
    alternative the user explicitly rejected — would have been); this
    scales with total election count, not votes cast, and is a candidate
    for a future multicall/mirror-migration if that count ever grows
    large, not built now since there's no evidence yet it needs to be.
    New test: `backend/test/admin/adminMyElections.test.ts` (its own
    file/app instance, not appended to `admin.test.ts`, because it needed
    a fake `IElectionContractClient` with a genuinely working
    `hasVoted()`, unlike `admin.test.ts`'s shared role-check-only fake).

    **Verified in-sandbox:** `tsc -b --noEmit` ✅ clean, `eslint
    src/modules/admin test/admin` ✅ clean, and `npx vitest run
    test/middleware/ test/wallet/ test/env.test.ts` ✅ 30/30 (confirms
    `buildApp()`'s module graph still loads fine with the new
    cross-module imports). **Could NOT verify in-sandbox** that
    `adminMyElections.test.ts` itself passes, nor that the existing
    `admin`/`election`/`voting` suites still pass unchanged — all need
    `mongodb-memory-server`, blocked by the already-documented
    `fastdl.mongodb.org` sandbox restriction. **Needs the user's real
    `pnpm --filter backend test` run to confirm**, same as every other
    Mongo-backed suite in this document — please run it and report back
    so this can be marked CONFIRMED, not just in-sandbox-typechecked.
11. **Voter Dashboard page slice is DONE and verified** (2026-07-13
    session), built on item 10's endpoint. New: `frontend/src/hooks/
    useMyElections.ts`, `frontend/src/components/MyElectionRow.tsx` +
    test, `frontend/src/pages/VoterDashboard.test.tsx`;
    `VoterDashboard.tsx` rewritten. Same connect/sign-in prompt pattern
    as `RegistrationGate` (not duplicated logic, just the same visual
    convention); "Registered" badge is driven by `onChainConfirmed`, not
    `status`, same rule as `RegistrationGate`.

    **A real bug was caught and fixed before it shipped, not after:**
    the backend's `getMyElectionStatuses()` initially returned only the
    on-chain `electionId`, and the first draft of `MyElectionRow`
    linked to `/elections/${election.electionId}` — which would have
    routed to the WRONG id space (the frontend's `/elections/:id` route
    expects the Mongo draft id, per item 8's own ID-space fix earlier
    this session). Caught during review before running tests, not by
    the tests themselves: fixed by adding an `id` field (the Mongo draft
    id) to `MyElectionStatus` on both backend and frontend, and a
    dedicated test in `adminMyElections.test.ts` now asserts `id` is the
    Mongo id and not the on-chain number, plus a frontend test in
    `MyElectionRow.test.tsx` asserts the link href directly. Worth
    remembering: this exact class of bug (conflating the two ID spaces)
    is easy to reintroduce in any future component that links to an
    election from data shaped like `MyElectionStatus`/`ElectionSummary`.

    **Verified in-sandbox (frontend):** `tsc -b --noEmit` ✅, `eslint .`
    ✅, `npx vitest run` ✅ **52/52 tests** across 13 files, `npx vite
    build` ✅. Backend-side verification status is unchanged from item
    10 (still needs the user's real `pnpm --filter backend test` run).
12. **Real bug found and fixed: `backend/.env` was never actually loaded
    for local dev** (2026-07-13 session, caught by the user's own first
    real `pnpm --filter @dvs/backend dev:api` run — every required env
    var reported `Required` even with a correctly filled-in `.env` file
    present). Root cause: no `dotenv` package existed anywhere in this
    backend. `docker-compose.yml`'s `env_file: ./backend/.env` directive
    only loads it for the Docker-composed `api`/`worker` services — the
    documented local-dev path (`pnpm --filter @dvs/backend dev:api`,
    running `tsx watch src/app.ts` directly on the host) was never
    exercised end-to-end by anyone until now, so this gap sat
    undetected. No test caught it either: every backend test sets env
    vars directly via `Object.assign(process.env, REQUIRED_ENV, ...)`
    before importing `app.ts`, which never exercises `.env`-file loading
    at all.

    **Fix:** added `dotenv` as a real dependency
    (`backend/package.json`), and `import "dotenv/config";` as the
    literal first line of both `backend/src/app.ts` and
    `backend/worker/worker.ts` — before every other import, since
    `src/config/env.ts` parses `process.env` at module-load time and
    could be transitively imported by anything below. Safe for tests:
    dotenv's default behavior never overwrites a `process.env` key that
    already exists, so the `Object.assign`-then-import order every test
    file already uses is unaffected.

    **Verified in-sandbox:** `tsc -b --noEmit` ✅, `eslint src/app.ts
    worker/worker.ts` ✅, `npx vitest run test/middleware/ test/wallet/
    test/env.test.ts` ✅ 30/30 unchanged. Full Mongo-backed suite
    verification still needs the user's real `pnpm --filter backend
    test` run, same outstanding item as #10/#11 above.

    **Separately, also worth double-checking**: the user's `.env` had
    contract addresses from an earlier `deploy:local` run
    (`0x5FbDB2315678afecb367f032d93F642f64180aa3`/
    `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`) that no longer match
    the addresses their most recent deploy actually printed
    (`0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`/
    `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`) — a Hardhat node
    restart resets the deterministic deploy-address sequence, so `.env`
    needs updating to match whichever deploy is actually live on the
    currently-running local chain, not whichever deploy happened first.

    **RESOLVED and CONFIRMED by the user's real run (2026-07-13):** with
    the `dotenv` fix and corrected contract addresses in place, the
    actual remaining blocker turned out to be a third, unrelated issue:
    `BACKEND_SIGNER_PRIVATE_KEY` in the user's `.env` was 65 hex
    characters, not the required 64 (one extra trailing character,
    likely a copy/paste slip). Worth noting this did NOT reveal a
    validation gap — `env.ts`'s zod schema already enforces this exact
    shape (`z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional()`), so this
    would have failed loudly with a specific `Invalid environment
    configuration` message identifying the field, same as every other
    misconfigured var — the user just hadn't yet gotten far enough past
    the dotenv-loading gap to see that particular error message before
    fixing this. No code change needed for this part; recording it here
    purely as a debugging-history note in case a similar "everything
    looks right but the API won't start" report comes up again locally.
    Local dev stack (Hardhat node + Docker Mongo/Redis + backend API +
    worker + frontend) is now confirmed working end-to-end on the user's
    machine.
13. **Admin Dashboard + Registration Requests slice is DONE and
    verified** (2026-07-13 session) — `RoleGuard`'s first real use, gating
    every `/admin/*` route. Built with **zero new backend work for the
    review queue itself** — `GET /admin/registration-requests` and the
    approve/reject endpoints already existed and were already
    role-gated.

    **A real security gap was found and fixed while reading these
    routes, before building on top of them:** `GET
    /admin/registration-requests` (the list endpoint) was missing
    `requireRole(ELECTION_ADMINISTRATOR_ROLE)` entirely — every sibling
    write endpoint in `admin.routes.ts` already had it (approve, reject),
    this GET was the sole outlier. Any authenticated wallet, not just
    admins, could previously list every registration request across
    every election, including other voters' addresses and review status.
    Fixed by adding the missing middleware. Not caught by any pre-existing
    test either — `admin.test.ts`'s `beforeEach` defaults the fake role
    check to `true`, so every prior test of this endpoint incidentally
    held the role anyway and the gap never surfaced; a new explicit
    non-admin regression test now covers it.

    **New backend endpoint: `GET /admin/me/role`** — RoleGuard's data
    source. Per the user's approved decision, this goes through the
    backend (reusing `requireRole`'s exact `hasRole` check, extracted
    into a shared `checkHasRoleOnEitherContract()` function so
    enforcement and this plain-read endpoint share one implementation,
    not two) rather than a direct on-chain frontend read — keeps "reads
    go through backend" consistent everywhere, no exception carved out
    for role checks.

    **New frontend pieces:** `frontend/src/hooks/useAdminRole.ts`,
    `useRegistrationRequests.ts` (list + approve/reject mutations),
    `useConfirmRegistration.ts` (the on-chain `registerVoter()` write —
    deliberately a SEPARATE action from "Approve," not folded into one
    button: approving is a free off-chain review decision, confirming is
    a real transaction the admin's own wallet pays gas for, and hiding
    that distinction behind one button would misrepresent the cost);
    `frontend/src/components/RoleGuard.tsx`,
    `RegistrationRequestRow.tsx`; `AdminDashboard.tsx` and
    `RegistrationRequests.tsx` rewritten from placeholders; `Header.tsx`
    now shows a "Dashboard" link for any connected wallet and an "Admin"
    link that's fully hidden (not just disabled) for non-admin wallets —
    `RoleGuard` is still the real enforcement if someone navigates there
    directly.

    **Verified in-sandbox (frontend):** `tsc -b --noEmit` ✅, `eslint .`
    ✅, `npx vitest run` ✅ **62/62 tests** across 16 files, `npx vite
    build` ✅. **Verified in-sandbox (backend):** `tsc -b --noEmit` ✅,
    `eslint src/modules/admin src/modules/auth test/admin` ✅, `npx
    vitest run test/middleware/ test/wallet/ test/env.test.ts` ✅ 30/30
    unchanged (confirms the `auth.roles.middleware.ts` refactor didn't
    break module loading). Full Mongo-backed backend suite (including the
    new `GET /admin/me/role` tests and the security-fix regression test,
    both added to `test/admin/admin.test.ts`) still needs the user's real
    `pnpm --filter backend test` run — same outstanding item as
    #10-#12.

    **Not done, called out explicitly:** `CreateElection` is still a
    placeholder — deferred to its own slice, since it needs an on-chain
    election-linking flow bigger than this one. `Landing`/`ElectionDetail`
    were not revisited to reflect an admin's registration approval
    becoming visible faster — that's already covered by existing
    query-invalidation (`useConfirmRegistration` invalidates
    `registration-status`/`my-elections` on confirm), just noting no new
    UI was added there.
14. **Create Election wizard slice is DONE and verified** (2026-07-14
    session) — the last of the 7 Section 9 pages, and the biggest single
    slice this project: a resumable multi-step admin wizard (draft →
    on-chain `createElection()` → link → per-candidate `addCandidate()`,
    each with an optional IPFS image upload) plus an "in progress" list
    on Admin Dashboard so a wizard abandoned partway through is actually
    reachable again, not just theoretically resumable.

    **User's approved call: resumability, not single-sitting-only.** The
    wizard's current step is derived entirely from the fetched draft's
    own state (`electionId === null` vs set, `candidateCount` vs
    `MIN_CANDIDATES_FOR_COMPLETE`) — there is no separate "wizard
    progress" field anywhere that could drift out of sync with reality.
    `MIN_CANDIDATES_FOR_COMPLETE = 2` is a frontend-only UX guard (no
    such minimum exists anywhere in the codebase before this session,
    confirmed by search) — the contract itself has no minimum candidate
    count.

    **How the two new on-chain values get read back**: `createElection()`
    returns the new `electionId` as a function return value, and
    `addCandidate()` similarly returns `candidateId` — neither is
    observable from a transaction receipt on the frontend, only emitted
    event LOGS are. `useCreateElectionOnChain.ts`/`useAddCandidate.ts`
    both decode `ElectionCreated`/`CandidateAdded` from the receipt's
    logs instead (same principle the worker's own `eventSync.ts` already
    relies on for reading chain state, just wallet-side here).

    **`useConfirmRegistration`'s "separate action, not one button"
    principle repeats here**: approving a registration is free, so is
    creating an off-chain draft; `createElection()` and each
    `addCandidate()` call cost real gas. The wizard never hides that a
    step is a transaction behind a label that makes it look like a form
    save.

    **A real ESLint/tooling incompatibility was found and fixed, not
    worked around with a broken suppression**: `eslint-plugin-
    react-hooks@4.6.2` crashes outright (`context.getSource is not a
    function`) when resolving an `eslint-disable-next-line
    react-hooks/exhaustive-deps` comment under ESLint 9's newer internal
    API — a known upstream version incompatibility, not a bug in this
    codebase. Rather than leaving a crashing suppression in place, both
    `LinkStep.tsx` and `CandidatesStep.tsx`'s "act once when a
    transaction confirms" effects were restructured with a `useRef`
    guard that genuinely satisfies `exhaustive-deps` — which is also a
    real correctness improvement, not just a lint workaround: the guard
    makes the once-per-confirmation logic idempotent regardless of
    whether `refetch`/mutation-object identity is stable across renders,
    where the old suppressed version was implicitly assuming it wasn't
    called twice.

    **New backend?** None — this slice is 100% frontend, reusing
    `POST /elections/draft`, `PATCH /elections/draft/:id/link-onchain`,
    `GET /elections` (via the existing `useAdminElections.ts`, which
    deliberately does NOT filter drafts the way `useElections.ts` does
    for the public Landing page — two hooks, two different audiences,
    same underlying endpoint), and `POST /ipfs/upload`, all already
    built and role-gated.

    **New frontend pieces:** `frontend/src/hooks/useCreateDraft.ts`,
    `useCreateElectionOnChain.ts`, `useLinkOnChain.ts`,
    `useAddCandidate.ts`, `useUploadImage.ts` (bypasses `apiClient.ts`'s
    JSON-only helper for multipart form data, keeping the same
    `credentials:"include"`/`ApiError` contract), `useSetCandidateProfile.ts`,
    `useAdminElections.ts`; `frontend/src/components/create-election/
    DetailsStep.tsx` (+ test), `LinkStep.tsx`, `CandidatesStep.tsx`;
    `CreateElection.tsx` rewritten as the resumable orchestrator (+
    test); `AdminDashboard.tsx` gets its "in progress" section (+ test);
    `router.tsx` gets the new `/admin/elections/:id/continue` route.

    **Verified in-sandbox:** `tsc -b --noEmit` ✅, `eslint .` ✅ (after
    the ESLint-crash fix above), `npx vitest run` ✅ **79/79 tests**
    across 20 files, `npx vite build` ✅.

    **Not done, called out explicitly:** `LinkStep.tsx`/
    `CandidatesStep.tsx`'s own wagmi-`writeContract`/receipt-decoding
    internals are NOT covered by dedicated tests — `CreateElection.test.tsx`
    deliberately stubs both components out to isolate the orchestrator's
    step-selection branching (the part with real correctness risk: wrong
    step shown = wrong data lost), not because their internals don't
    matter. Testing `useWriteContract`/`useWaitForTransactionReceipt`'s
    full state-transition surface plus event-log decoding would need
    substantially heavier wagmi mocking than this session's other write
    hooks (`useCastVote.ts`, `useConfirmRegistration.ts`) needed, since
    those never had dedicated tests either — this is a consistent gap
    across every on-chain write hook in this app, not new to this slice,
    worth a dedicated testing pass if it becomes a priority. This
    project's only Election with real content will need to go through
    this actual wizard by hand (`pnpm --filter @dvs/frontend dev`) to be
    fully confident in it beyond what static analysis can confirm.
15. **Results/Archive page is DONE and verified** (2026-07-15 session) —
    the last of the 7 Section 9 pages. Reuses `useElections()` (filtered
    client-side to `result_finalized`) and a new
    `frontend/src/components/ArchiveElectionCard.tsx` (composes the
    already-built `ElectionStateStrip`/`ResultsBar`) — no new backend
    surface at all. Scope decision: full results shown inline for every
    finalized election rather than card-only links out, matching
    Landing's own "verifiable at a glance" hero copy.

    **Self-caused incident, recorded honestly:** mid-way through this
    slice, a prior message asked to re-confirm an unrelated file
    delivery; answering that took priority for one turn, and the
    in-progress `ResultsArchive.tsx` rewrite was left **mid-delete** —
    the old placeholder had already been removed but the replacement
    hadn't been written yet, leaving `router.tsx`'s import genuinely
    broken (would have failed `vite build`) until the user's own
    screenshot of the still-placeholder page prompted a check that caught
    it. The zip delivered earlier in that same session was NOT affected
    (it was built before the deletion), but the live working copy was
    briefly in a broken state with no test run to catch it, since no
    verification was run between the deletion and the fix. Lesson worth
    keeping in mind for future multi-step file rewrites in this
    project: don't let an unrelated request interleave with a
    delete-then-recreate step without finishing it first, or at minimum
    re-run `tsc -b`/`vite build` before considering the working copy
    stable again.

    **Verified in-sandbox:** `tsc -b --noEmit` ✅ (this is what would
    have caught the broken import, had it been run at the time — it
    wasn't, until this fix), `eslint .` ✅, `npx vitest run` ✅
    **85/85 tests** across 22 files, `npx vite build` ✅ (this
    specifically re-confirms the previously-broken `router.tsx` import
    now resolves).

    **All 7 Section 9 pages now have real content.** Remaining known
    gaps across the whole Phase 4 effort: on-chain write hooks lack
    dedicated tests (see item 14's note, applies here too — this slice
    added no new write hooks, so nothing new on that front); Sepolia
    deployment is still deferred (item 4); `contracts/scripts` still
    doesn't read `shared/contract-addresses.json` (item 6's original
    gap, still open).

## Files worth knowing about at repo root
- `PHASE2_STATUS.md`, `PHASE3_MANIFEST.md` — prior session status notes,
  superseded by this handoff but harmless to keep.
- `PHASE4_SCAFFOLD_MANIFEST.md` — file-by-file list of this session's
  Phase 4 scaffold slice (design tokens/theme, routing, wallet/auth). The
  Frontend section above has the durable design-decision summary; this
  manifest has the mechanical file list and verification command output.
- `shared/contract-addresses.json` — per-chain contract addresses
  (currently placeholder zeros for both `31337`/local and
  `11155111`/Sepolia — Sepolia deployment is still deferred, see item 4's
  entry above). Read by `frontend/src/lib/contractAddresses.ts`; NOT yet
  read by `contracts/scripts` (see Frontend section above).
- `contracts/verify-compile.cjs` — the sandbox-network-workaround compile
  script described above. Keep it.
- `.github/workflows/ci.yml` — item 3's CI pipeline. DONE and CONFIRMED
  by a real green run this session (2026-07-12); see item 3's entry
  above for what changed from the original in-sandbox draft and why.