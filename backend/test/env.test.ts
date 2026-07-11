// Phase 1 smoke test: the env config module must fail fast and loudly on
// invalid configuration (Section 18's core rationale), and must succeed
// when given a complete, valid set of variables. This is tested in
// isolation here because every other module in the backend depends on it.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const REQUIRED_VALID_ENV = {
  RPC_URL_PRIMARY: "https://eth-sepolia.g.alchemy.com/v2/test-key",
  RPC_URL_FALLBACK: "https://sepolia.infura.io/v3/test-key",
  CONTRACT_ADDRESS_VOTER_REGISTRY: "0x0000000000000000000000000000000000000001",
  CONTRACT_ADDRESS_ELECTION: "0x0000000000000000000000000000000000000002",
  MONGODB_URI: "mongodb://localhost:27017/test",
  REDIS_URL: "redis://localhost:6379",
  IPFS_API_KEY: "test-ipfs-key",
  IPFS_API_SECRET: "test-ipfs-secret",
  SIWE_DOMAIN: "localhost:5173",
  SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
  FRONTEND_ORIGIN: "http://localhost:5173",
  RESEND_API_KEY: "test-resend-key",
};

describe("env config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads successfully with a complete, valid environment", async () => {
    Object.assign(process.env, REQUIRED_VALID_ENV);

    // Dynamic import so the module's top-level loadEnv() call runs against
    // the env we just set, rather than whatever was present at test-file
    // import time.
    const { env } = await import("../src/config/env.ts?valid-case");

    expect(env.CHAIN_ID).toBe(11155111); // default applied correctly
    expect(env.API_PORT).toBe(4000); // default applied correctly
    expect(env.MONGODB_URI).toBe("mongodb://localhost:27017/test");
  });

  it("throws a clear error when a required variable is missing", async () => {
    Object.assign(process.env, REQUIRED_VALID_ENV);
    delete process.env.MONGODB_URI;

    await expect(import("../src/config/env.ts?missing-case")).rejects.toThrow(
      /Invalid environment configuration/,
    );
  });

  it("throws a clear error when a contract address is malformed", async () => {
    Object.assign(process.env, REQUIRED_VALID_ENV);
    process.env.CONTRACT_ADDRESS_ELECTION = "not-an-address";

    await expect(import("../src/config/env.ts?malformed-case")).rejects.toThrow(
      /Invalid environment configuration/,
    );
  });
});