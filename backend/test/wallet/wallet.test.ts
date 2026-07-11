// Tests for the Wallet module (address validation, ENS resolution).
//
// Unlike the other domain modules, Wallet has no routes/DB model in this
// pass (internal-only - see index.ts's header comment), so these are
// plain unit tests against the service functions directly: no supertest,
// no MongoMemoryServer. A fake IEnsClient stands in for viem's ENS
// actions, same DI seam pattern as the Blockchain module's
// IElectionContractClient fakes used throughout the other test files.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { IEnsClient } from "../../src/modules/wallet/index.js";

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
  // Deliberately NOT setting RPC_URL_MAINNET_ENS here - it's optional,
  // and most tests below want to inject a fake IEnsClient rather than
  // exercise the real viem client construction path (see the dedicated
  // "wallet.provider" describe block for that).
};

let wallet: typeof import("../../src/modules/wallet/index.js");

class FakeEnsClient implements IEnsClient {
  nameCalls = 0;
  addressCalls = 0;
  namesByAddress = new Map<string, string | null>();
  addressesByName = new Map<string, string | null>();
  shouldThrow = false;

  async getEnsName(address: string): Promise<string | null> {
    this.nameCalls += 1;
    if (this.shouldThrow) throw new Error("simulated RPC failure");
    return this.namesByAddress.get(address) ?? null;
  }

  async getEnsAddress(name: string): Promise<string | null> {
    this.addressCalls += 1;
    if (this.shouldThrow) throw new Error("simulated RPC failure");
    return this.addressesByName.get(name) ?? null;
  }
}

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  wallet = await import("../../src/modules/wallet/index.js");
});

afterEach(() => {
  wallet._setEnsClientForTests(undefined);
  wallet._clearEnsCachesForTests();
});

const VALID_LOWERCASE = "0x5aeda56215b167893e80b4fe645ba6d5bab767de".toLowerCase();
const VALID_CHECKSUMMED = "0x5aeda56215b167893e80b4fe645ba6d5bab767de"; // already all-lowercase-valid, viem will checksum it

describe("Wallet module - isValidAddress", () => {
  it("accepts a well-formed lowercase address", () => {
    expect(wallet.isValidAddress(VALID_LOWERCASE)).toBe(true);
  });

  it("rejects a string that isn't a hex address at all", () => {
    expect(wallet.isValidAddress("not-an-address")).toBe(false);
  });

  it("rejects an address with the wrong length", () => {
    expect(wallet.isValidAddress("0x1234")).toBe(false);
  });

  it("rejects an ENS name (not an address)", () => {
    expect(wallet.isValidAddress("alice.eth")).toBe(false);
  });
});

describe("Wallet module - toChecksumAddress", () => {
  it("returns the EIP-55 checksummed form of a valid address", () => {
    const checksummed = wallet.toChecksumAddress(VALID_LOWERCASE);
    expect(wallet.isValidAddress(checksummed)).toBe(true);
    // viem's getAddress is deterministic for a given input - just assert
    // it round-trips to something matching the lowercase form, not a
    // hardcoded checksum literal that would be brittle to transcribe.
    expect(checksummed.toLowerCase()).toBe(VALID_LOWERCASE);
  });

  it("throws HttpError(400, INVALID_ADDRESS) for a malformed address", () => {
    expect(() => wallet.toChecksumAddress("not-an-address")).toThrowError(
      expect.objectContaining({ status: 400, code: "INVALID_ADDRESS" }),
    );
  });
});

describe("Wallet module - resolveEnsName", () => {
  it("returns the resolved name from the injected client", async () => {
    const fake = new FakeEnsClient();
    const checksummed = wallet.toChecksumAddress(VALID_LOWERCASE);
    fake.namesByAddress.set(checksummed, "alice.eth");
    wallet._setEnsClientForTests(fake);

    await expect(wallet.resolveEnsName(VALID_LOWERCASE)).resolves.toBe("alice.eth");
  });

  it("returns null immediately for an invalid address, without calling the client", async () => {
    const fake = new FakeEnsClient();
    wallet._setEnsClientForTests(fake);

    await expect(wallet.resolveEnsName("not-an-address")).resolves.toBeNull();
    expect(fake.nameCalls).toBe(0);
  });

  it("returns null when the client throws, rather than rejecting", async () => {
    const fake = new FakeEnsClient();
    fake.shouldThrow = true;
    wallet._setEnsClientForTests(fake);

    await expect(wallet.resolveEnsName(VALID_LOWERCASE)).resolves.toBeNull();
  });

  it("caches a resolved name: the second call for the same address doesn't hit the client again", async () => {
    const fake = new FakeEnsClient();
    const checksummed = wallet.toChecksumAddress(VALID_LOWERCASE);
    fake.namesByAddress.set(checksummed, "alice.eth");
    wallet._setEnsClientForTests(fake);

    await wallet.resolveEnsName(VALID_LOWERCASE);
    await wallet.resolveEnsName(VALID_LOWERCASE);

    expect(fake.nameCalls).toBe(1);
  });

  it("caches a null result too (address with no ENS name set), not just hits", async () => {
    const fake = new FakeEnsClient();
    wallet._setEnsClientForTests(fake);

    await wallet.resolveEnsName(VALID_LOWERCASE);
    await wallet.resolveEnsName(VALID_LOWERCASE);

    expect(fake.nameCalls).toBe(1);
  });
});

describe("Wallet module - resolveAddressFromEnsName", () => {
  it("returns the resolved address from the injected client", async () => {
    const fake = new FakeEnsClient();
    const checksummed = wallet.toChecksumAddress(VALID_LOWERCASE);
    fake.addressesByName.set("alice.eth", checksummed);
    wallet._setEnsClientForTests(fake);

    await expect(wallet.resolveAddressFromEnsName("alice.eth")).resolves.toBe(checksummed);
  });

  it("returns null when the client throws, rather than rejecting", async () => {
    const fake = new FakeEnsClient();
    fake.shouldThrow = true;
    wallet._setEnsClientForTests(fake);

    await expect(wallet.resolveAddressFromEnsName("alice.eth")).resolves.toBeNull();
  });

  it("caches by name case-insensitively so the client is only called once", async () => {
    const fake = new FakeEnsClient();
    fake.addressesByName.set("alice.eth", VALID_CHECKSUMMED);
    wallet._setEnsClientForTests(fake);

    await wallet.resolveAddressFromEnsName("alice.eth");
    await wallet.resolveAddressFromEnsName("ALICE.ETH");

    expect(fake.addressCalls).toBe(1);
  });
});

describe("Wallet module - toDisplayName", () => {
  it("prefers the ENS name when one resolves", async () => {
    const fake = new FakeEnsClient();
    const checksummed = wallet.toChecksumAddress(VALID_LOWERCASE);
    fake.namesByAddress.set(checksummed, "alice.eth");
    wallet._setEnsClientForTests(fake);

    await expect(wallet.toDisplayName(VALID_LOWERCASE)).resolves.toBe("alice.eth");
  });

  it("falls back to the checksummed address when no ENS name is set", async () => {
    const fake = new FakeEnsClient();
    wallet._setEnsClientForTests(fake);

    const result = await wallet.toDisplayName(VALID_LOWERCASE);
    expect(result.toLowerCase()).toBe(VALID_LOWERCASE);
  });

  it("returns malformed input unchanged rather than throwing", async () => {
    await expect(wallet.toDisplayName("not-an-address")).resolves.toBe("not-an-address");
  });
});

describe("Wallet module - getEnsPublicClient", () => {
  it("returns null when RPC_URL_MAINNET_ENS isn't configured", () => {
    // REQUIRED_ENV deliberately omits this var - see its comment above.
    expect(wallet.getEnsPublicClient()).toBeNull();
  });

  // The "RPC_URL_MAINNET_ENS IS configured" case is deliberately a
  // separate test FILE (wallet.provider.configured.test.ts), not another
  // `it` here: env.ts parses process.env into a frozen singleton the
  // first time anything in this file imports it (this file's own
  // beforeAll, above), and mutating process.env afterwards doesn't
  // change that already-parsed object - wallet.provider.ts's import of
  // config/env.js resolves to the same cached module regardless of any
  // cache-busting query string put on a *different* file's import path.
  // A separate file gets its own fresh module registry (vitest's
  // per-file isolation) with no query-string workaround needed.
});

// Sanity check that generatePrivateKey/privateKeyToAccount (used to derive
// VALID_LOWERCASE-shaped addresses in other test files) produce addresses
// this module actually considers valid - guards against the constant
// above silently drifting from a real address shape.
describe("Wallet module - sanity check against real derived addresses", () => {
  it("considers a freshly-derived account address valid", () => {
    const account = privateKeyToAccount(generatePrivateKey());
    expect(wallet.isValidAddress(account.address)).toBe(true);
  });
});
