// Covers the RPC_URL_MAINNET_ENS-configured path of getEnsPublicClient.
// Deliberately a separate file from wallet.test.ts: env.ts parses
// process.env into a frozen singleton the first time it's imported by a
// given test file's module registry, so this case needs its own fresh
// registry (vitest isolates per-file) with RPC_URL_MAINNET_ENS already
// set before that first import - see wallet.test.ts's comment on this
// for the full explanation of why the obvious "just set it later in the
// same file" approach doesn't work here.

import { beforeAll, describe, expect, it } from "vitest";

const REQUIRED_ENV = {
  NODE_ENV: "test",
  RPC_URL_PRIMARY: "http://127.0.0.1:8545",
  RPC_URL_FALLBACK: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  CONTRACT_ADDRESS_ELECTION: "0x0000000000000000000000000000000000000001",
  CONTRACT_ADDRESS_VOTER_REGISTRY: "0x0000000000000000000000000000000000000002",
  MONGODB_URI: "mongodb://localhost:27017/unused-by-these-tests",
  REDIS_URL: "redis://localhost:6379",
  IPFS_API_KEY: "test-ipfs-key",
  IPFS_API_SECRET: "test-ipfs-secret",
  RESEND_API_KEY: "test-resend-key",
  SIWE_DOMAIN: "localhost:5173",
  SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
  FRONTEND_ORIGIN: "http://localhost:5173",
  RPC_URL_MAINNET_ENS: "https://eth-mainnet.example.com/v2/test-key",
};

let wallet: typeof import("../../src/modules/wallet/index.js");

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  wallet = await import("../../src/modules/wallet/index.js");
});

describe("Wallet module - getEnsPublicClient (RPC_URL_MAINNET_ENS configured)", () => {
  it("returns a real, mainnet-chained client rather than null", () => {
    const client = wallet.getEnsPublicClient();
    expect(client).not.toBeNull();
    expect(client?.chain?.id).toBe(1); // mainnet
  });

  it("returns the same cached client instance on a second call", () => {
    const first = wallet.getEnsPublicClient();
    const second = wallet.getEnsPublicClient();
    expect(first).toBe(second);
  });
});
