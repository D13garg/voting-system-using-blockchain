import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The Phase 3 blockchain integration test spawns a real local Hardhat
    // node and needs a working Hardhat toolchain (hardhat compile) - it
    // must never be part of the fast default unit suite. See
    // vitest.integration.config.ts and test/integration/harness.ts.
    exclude: ["test/integration/**", "node_modules/**"],
    testTimeout: 15000,
    fileParallelism: false,
  },
});