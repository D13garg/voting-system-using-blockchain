# Phase 2 — Current Status (Smart Contracts)

## Test run #1 results (your machine, real network access)

`npx hardhat test` ran successfully end-to-end: **compiled 11 Solidity
files with no errors**, and **7 of 37 tests passed** on the first try,
including security-relevant ones (per-election eligibility isolation,
correct multi-candidate vote tallying, role-based pause/unpause). The
remaining 30 failures were **all the same root cause** — not 30 separate
bugs:

```
Error: Invalid Chai property: revertedWithCustomError
Error: Invalid Chai property: emit. Did you mean "exist"?
```

**Root cause, fully traced (not guessed):** `pnpm why chai` revealed two
chai major versions in the workspace — `chai@4.5.0` (what
`@nomicfoundation/hardhat-chai-matchers` patches with `.emit()` /
`.revertedWithCustomError()`) and `chai@5.3.3` (pulled in transitively by
`vitest`, used by the unrelated `@dvs/backend` and `@dvs/frontend`
packages). `@dvs/contracts` had no *direct* devDependency on `chai` at
all — it only got chai transitively through `hardhat-toolbox` — and under
pnpm's strict, non-hoisting `node_modules` layout, that was apparently
enough ambiguity for the test files' `import { expect } from "chai"` to
not reliably resolve to the patched instance.

**Fix applied:**
1. Added `chai`, `mocha`, and `@nomicfoundation/hardhat-chai-matchers` as
   **direct, pinned devDependencies** of `@dvs/contracts` (previously only
   pulled in transitively).
2. Explicitly imported `@nomicfoundation/hardhat-chai-matchers` in
   `hardhat.config.ts` rather than relying solely on `hardhat-toolbox`'s
   transitive registration.
3. Re-ran `pnpm why chai` after the fix: `@dvs/contracts` now resolves to
   `chai@4.5.0` through three independent dependency paths that all agree
   (direct, via `hardhat-chai-matchers`, via `chai-as-promised`). The
   `chai@5.3.3` instance still exists in the workspace (for vitest) but no
   longer has any path into `@dvs/contracts`'s resolution.
4. Also fixed a second, smaller, genuinely separate bug caught by `tsc`
   while verifying the above: an implicit-`any` parameter on a `.find()`
   callback in `Election.test.ts` (a different line than the one fixed in
   the previous round — same general pattern, missed on the first pass).

**This was not run again in this sandbox** — the same
`binaries.soliditylang.org` network block from before still applies. The
fix is reasoned from a fully-traced root cause (the `pnpm why chai` output
above is conclusive, not circumstantial) and confirmed not to break
anything via `tsc --noEmit` and the standalone `solc` compile check, both
of which still pass clean. But the actual test run is — again — the real
bar, not my confidence. **Please re-run `npx hardhat test` and report
back.**

## Done and verified

- `contracts/contracts/AccessRoles.sol`, `VoterRegistry.sol`,
  `Election.sol` — compiled successfully by real Hardhat + real solc on
  your machine (test run #1). This is now confirmed by actual execution,
  not just the standalone solc check.
- `contracts/test/VoterRegistry.test.ts`, `Election.test.ts` — the 7
  passing tests confirm core logic (per-election eligibility, vote
  tallying, role setup, pause/unpause) is correct as written. The other 30
  are expected to pass once the chai-matchers fix is confirmed.
- `contracts/scripts/deploy.ts`, `verify.ts` — written, `tsc`-clean,
  not yet run against a live network (next step after tests are green).

## NOT yet done

- Confirmation that the chai-matchers fix actually resolves all 30
  failures — **waiting on your next test run.**
- Slither static analysis.
- Coverage report (`hardhat coverage`).
- A real local-network run of `deploy.ts` to confirm the deployment script
  itself works end-to-end (address persistence, role wiring).

## What to do with this package

1. `pnpm install` at the repo root (picks up the new chai/mocha/
   hardhat-chai-matchers devDependencies).
2. `cd contracts && npx hardhat test`.
3. Report back. If still failing, paste the exact output again — if
   chai-matchers is still somehow not registering, the next thing to check
   would be `npx hardhat --version` and `node -e "console.log(require('chai/package.json').version)"` run from inside `contracts/`, to see exactly
   which physical chai file is being loaded at runtime.
4. Once green: `npx hardhat coverage`, then I'll review `deploy.ts`
   against a real `npx hardhat node` run's output before calling Phase 2
   done.


