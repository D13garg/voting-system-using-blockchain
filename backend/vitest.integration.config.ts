import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.test" });

// Separate config for the Phase 3 blockchain integration test
// (test/integration/blockchain.integration.test.ts). Run via
// `pnpm test:integration`, never via the default `pnpm test`.
//
// Requires a working Hardhat toolchain (network access to
// binaries.soliditylang.org for `hardhat compile`) - see
// test/integration/harness.ts's header comment. Long timeout: spinning up
// a real Hardhat node, running the real deploy script, and mining several
// real transactions genuinely takes longer than the unit suite's 15s
// default.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The harness spawns/tears down a real child process and shares chain
    // state across it/describe blocks within the file by design (one
    // Hardhat node per file) - running test files in parallel workers is
    // unnecessary here and would just mean multiple redundant node
    // spin-ups.
    fileParallelism: false,
  },
});