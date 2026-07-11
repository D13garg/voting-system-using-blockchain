# Phase 3 — Changed Files Manifest

This zip contains the FULL repo state (everything from Phase 1/2 plus
Phase 3's additions), not a diff. Below is exactly what changed in this
session, so you don't have to diff 26 files by hand.

## New files — Blockchain Service Layer (ADR-004)

- `backend/src/modules/blockchain/provider.ts` — viem PublicClient, Alchemy primary / Infura fallback
- `backend/src/modules/blockchain/errors.ts` — BlockchainError normalization (CONTRACT_REVERT vs TRANSIENT_RPC vs UNKNOWN)
- `backend/src/modules/blockchain/signer.ts` — low-privilege backend signer (optional, per ADR-004)
- `backend/src/modules/blockchain/events.ts` — checkpoint-based polling log sync, explicit at-least-once contract documented
- `backend/src/modules/blockchain/gas.ts` — gas estimation helpers for frontend preview UX
- `backend/src/modules/blockchain/index.ts` — the module's only public import surface
- `backend/src/modules/blockchain/contracts/IElectionContractClient.ts` — interface, for testability + future contract versioning
- `backend/src/modules/blockchain/contracts/IVoterRegistryContractClient.ts` — interface
- `backend/src/modules/blockchain/contracts/ElectionContractClient.ts` — concrete viem-backed implementation
- `backend/src/modules/blockchain/contracts/VoterRegistryContractClient.ts` — concrete viem-backed implementation

## New files — ABI extraction (Phase 3 design decision)

- `contracts/scripts/extract-abi.ts` — pulls clean ABI JSON from Hardhat artifacts into `shared/abi/`, runs via `postcompile`
- `contracts/scripts/contractAddresses.ts` — shared, runtime-validated `ContractAddresses` type/reader (de-duplicated out of deploy.ts/verify.ts)
- `shared/abi/Election.json`, `shared/abi/VoterRegistry.json` — extracted ABI output (genuinely derived from real solc-compiled ABI data, not hand-written)

## New files — ESLint configs (closing the Phase 1 gap: lint was configured but never actually runnable)

- `backend/eslint.config.mjs`
- `contracts/eslint.config.mjs`
- `frontend/eslint.config.mjs`

## Modified files

- `package.json` (root) — added eslint/typescript-eslint as real devDependencies
- `pnpm-workspace.yaml` — (check this if your diff tool flags it; likely unchanged content, re-saved)
- `backend/package.json` — added eslint, globals, ts-node-adjacent deps as DIRECT devDependencies (not transitive) — same lesson as the Phase 2 chai bug
- `backend/src/middleware/errorHandler.ts` — removed a now-unnecessary eslint-disable comment
- `contracts/package.json` — same direct-devDependency fix (eslint, globals, ts-node, @types/node)
- `contracts/scripts/deploy.ts` — now imports the shared `contractAddresses.ts` instead of an inline duplicated interface + unsafe `JSON.parse`
- `contracts/scripts/verify.ts` — same fix as deploy.ts
- `contracts/test/Election.test.ts` — removed one genuinely unused `endTime` destructure (real bug, caught by lint)
- `frontend/package.json` — same direct-devDependency fix, plus React eslint plugins

## Verification status (all re-confirmed clean after every fix in this session)

- `backend`: `tsc --noEmit` ✅ zero errors. `eslint .` ✅ zero findings. `vitest run` ✅ 3/3 passing.
- `contracts`: `tsc --noEmit` ✅ zero errors (excluding the documented, expected `typechain-types` import gap — see PHASE2_STATUS.md). `eslint .` — 441 `no-unsafe-*` findings, ALL attributable to the same missing-TypeChain-types gap (confirmed: filtering out `no-unsafe-*` leaves zero remaining errors). Standalone `solc` compile check ✅ still produces correct bytecode for both contracts.
- `frontend`: `tsc -b --noEmit` ✅ zero errors. `eslint .` ✅ zero findings (only Phase 1 placeholder content exists so far).

## What's still open (carried forward, not forgotten)

- The 441 `no-unsafe-*` findings in `contracts` will very likely resolve to
  near-zero the moment you run `pnpm --filter @dvs/contracts compile`
  successfully on your machine (real network access) — TypeChain will
  generate real types, and Hardhat's `ethers` global stops being typed as
  `any`. Please run `npx eslint .` in `contracts/` after your next
  successful `hardhat compile` and report back the count.
- Slither static analysis — still deferred per your earlier sign-off.
- Sepolia deployment — still deferred per your earlier call to do Phase 3 first.
- The Blockchain Service Layer module has NOT been tested against a real
  chain (local Hardhat node or Sepolia) yet — only type-checked and
  lint-checked. Phase 3 isn't fully closed until that happens. Suggested
  next step: a small integration test in `backend/test/blockchain/` that
  spins up a local Hardhat node, deploys the contracts, and exercises
  `ElectionContractClient`/`VoterRegistryContractClient` against it for
  real — I haven't written this yet.
