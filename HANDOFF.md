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
explicit approval on any forked decision before implementing. Prefer
direct file output (`present_files`) over zips for 1-3 changed files;
package a zip and describe the diff in prose for more than that.

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

### Frontend (Phase 4) — NOT STARTED
Independent of everything above. Deliberately held off — see "Next
steps" below for why.

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

## Newly discovered pre-frontend items — 1/2/4 DONE and confirmed, 3/5 still open

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
3. **STILL OPEN - not started.** No CI pipeline exists at all.
   `architecture.md` Section 24's own production-readiness list names
   "CI pipeline gating (GitHub Actions: contract tests, Slither, backend
   tests, frontend build/lint, branch protection)" explicitly. `find
   .github -type f` returns nothing — there is no `.github/` directory
   anywhere in this repo. Unlike Slither and Sepolia deployment (both
   explicitly, deliberately deferred per the Contracts section above, the
   user's own call), CI was never flagged as deferred anywhere in this
   document or `decisions-log.md` — it's a genuine gap against the
   project's own stated checklist, not a documented deferral. Worth a
   real decision (build it now vs. explicitly defer it, the user's call
   either way) rather than it silently continuing to not exist. **Needs
   its own short design doc before being built** - GitHub Actions workflow
   structure, which jobs run on which triggers, whether Slither/Sepolia-
   deploy stay excluded per their own already-documented deferral - same
   discipline every other gap in this document got, don't skip it just
   because items 1/2/4 didn't strictly need one.
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
5. **STILL OPEN - not started.** Four of six architecture sequence
   `architecture.md`'s own "Additional refinement" section says vote
   casting and registration-approval diagrams shipped early, and "Create
   Election, Register Voter, Event Processing, and Finalize Election
   sequence diagrams will be added to this document during Phase 5/6
   implementation, once their exact message shapes are finalized" —
   confirmed via `grep -n "sequenceDiagram\|Sequence [Dd]iagram"
   docs/architecture/architecture.md`, only the original two exist.
   Documentation-only, zero runtime impact, lowest priority of the five —
   but a real gap against what this document promised itself it would
   contain, now that every message shape it was waiting on has long since
   been finalized. **Still open** — deferred to next session at the
   user's explicit call (2026-07-12 session), alongside item 3.

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

**Still open: item 3 (CI pipeline) and item 5 (4 sequence diagrams) —
neither started.** Neither blocks Phase 4 on technical grounds, same
framing as before. Item 3 in particular deserves its own short design doc
before being built (GitHub Actions workflow structure, which jobs run on
which triggers, whether Slither/Sepolia-deploy stay excluded per their
own already-documented deferral) — don't skip that step just because
items 1/2/4 didn't need one.



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
4. **Items 3 (CI pipeline) and 5 (4 sequence diagrams) are still fully
   open - neither started, not even a design doc yet.** Don't infer
   otherwise from items 1/2/4 being done; these two are genuinely
   untouched. Next session: pick up item 3 with its own short design doc
   first (don't skip that step - see item 3's entry above for why), then
   item 5.
5. **Phase 4 (Frontend) has not started** — still genuinely true, no
   change to `App.tsx` or the Phase-1 placeholder state this session. The
   user's original plan was to close every pre-frontend item first; items
   3 and 5 remaining open means that condition isn't fully satisfied yet,
   though neither is a technical blocker (same framing used throughout
   this document) if the user chooses to start Phase 4 before finishing
   them.

## Files worth knowing about at repo root
- `PHASE2_STATUS.md`, `PHASE3_MANIFEST.md` — prior session status notes,
  superseded by this handoff but harmless to keep.
- `contracts/verify-compile.cjs` — the sandbox-network-workaround compile
  script described above. Keep it.