// Phase 3 integration test: proves ElectionContractClient and
// VoterRegistryContractClient (backend/src/modules/blockchain/) work
// correctly against a REAL deployed chain, not just that they type-check.
// See harness.ts for full setup/lifecycle details, and HANDOFF.md's Phase
// 3 section for the design discussion and the forked decisions made along
// the way (raw-call test setup; dedicated test signer granted the role).
//
// NOT part of the default `pnpm test` run - see vitest.integration.config.ts.
// Run via `pnpm test:integration` from backend/. Requires a working
// Hardhat toolchain (network access to binaries.soliditylang.org); if
// that's unavailable, setup() throws a clear error explaining why, per
// this project's verification discipline (HANDOFF.md).
//
// Env vars are set on process.env in beforeAll, BEFORE any dynamic import
// of the blockchain module or src/config/env.ts - env.ts's `env` export
// is a module-load-time singleton (loadEnv() runs once, at import time),
// so anything that statically imported it before this point would have
// already frozen in whatever env.ts saw first. This file deliberately has
// no static imports of any src/ module for that reason (same pattern
// test/env.test.ts already uses for the same reason).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, teardown, RPC_URL, type SeededChainState } from "./harness.js";

const REQUIRED_NON_BLOCKCHAIN_ENV = {
  MONGODB_URI: "mongodb://localhost:27017/integration-test",
  REDIS_URL: "redis://localhost:6379",
  IPFS_API_KEY: "test-ipfs-key",
  IPFS_API_SECRET: "test-ipfs-secret",
  SIWE_DOMAIN: "localhost:5173",
  SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
  FRONTEND_ORIGIN: "http://localhost:5173",
};

describe("Blockchain Service Layer - integration (real local Hardhat node)", () => {
  let chain: SeededChainState;
  let electionClient: import("../../src/modules/blockchain/index.js").IElectionContractClient;
  let voterRegistryClient: import("../../src/modules/blockchain/index.js").IVoterRegistryContractClient;
  let BlockchainError: typeof import("../../src/modules/blockchain/index.js").BlockchainError;

  beforeAll(async () => {
    chain = await setup();

    Object.assign(process.env, REQUIRED_NON_BLOCKCHAIN_ENV, {
      NODE_ENV: "test",
      CHAIN_ID: "31337",
      RPC_URL_PRIMARY: RPC_URL,
      RPC_URL_FALLBACK: RPC_URL,
      CONTRACT_ADDRESS_ELECTION: chain.electionAddress,
      CONTRACT_ADDRESS_VOTER_REGISTRY: chain.voterRegistryAddress,
      BACKEND_SIGNER_PRIVATE_KEY: chain.backendSignerPrivateKey,
    });

    // Fresh import, cache-busted like test/env.test.ts, so this module
    // graph (and the env.ts singleton within it) loads against the env
    // vars just set above rather than anything set by another test file
    // that happened to run first in this worker.
    const blockchain = await import("../../src/modules/blockchain/index.js?integration-case");
    electionClient = blockchain.getElectionContractClient();
    voterRegistryClient = blockchain.getVoterRegistryContractClient();
    BlockchainError = blockchain.BlockchainError;
  }, 60_000);

  afterAll(async () => {
    await teardown();
  });

  describe("reads", () => {
    it("getElection returns the seeded election's real on-chain data", async () => {
      const election = await electionClient.getElection(chain.electionId);

      expect(election.title).toBe("Integration Test Election");
      expect(election.endTime).toBe(chain.endTime);
      expect(election.finalized).toBe(false);
      expect(election.candidateCount).toBe(1n);
    });

    it("getCandidate returns the seeded candidate's real on-chain data", async () => {
      const candidate = await electionClient.getCandidate(chain.electionId, chain.candidateId);

      expect(candidate.name).toBe("Alice");
      expect(candidate.metadataURI).toBe("ipfs://alice-metadata");
      expect(candidate.voteCount).toBe(0n);
    });

    it("electionCount reflects the one seeded election", async () => {
      await expect(electionClient.electionCount()).resolves.toBe(1n);
    });

    it("isPaused reflects the contract's real unpaused state", async () => {
      await expect(electionClient.isPaused()).resolves.toBe(false);
    });

    it("isRegisteredForElection returns false for a never-registered voter", async () => {
      await expect(
        voterRegistryClient.isRegisteredForElection(chain.electionId, chain.unregisteredVoterAddress),
      ).resolves.toBe(false);
    });
  });

  describe("writes", () => {
    it("registerVoter submits a real transaction and the voter becomes eligible", async () => {
      const result = await voterRegistryClient.registerVoter(chain.electionId, chain.unregisteredVoterAddress);

      expect(result.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.blockNumber).toBeGreaterThan(0n);

      await expect(
        voterRegistryClient.isRegisteredForElection(chain.electionId, chain.unregisteredVoterAddress),
      ).resolves.toBe(true);
    });

    it("removeVoter submits a real transaction and the voter's eligibility is revoked", async () => {
      await voterRegistryClient.removeVoter(chain.electionId, chain.unregisteredVoterAddress);

      await expect(
        voterRegistryClient.isRegisteredForElection(chain.electionId, chain.unregisteredVoterAddress),
      ).resolves.toBe(false);
    });

    it("finalizeElection submits a real transaction and the election reflects finalized=true", async () => {
      // chain.endTime has already elapsed by the time setup() returns
      // (harness.ts advances chain time past it), so this is exercising
      // the real success path, not a revert.
      const result = await electionClient.finalizeElection(chain.electionId);

      expect(result.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const election = await electionClient.getElection(chain.electionId);
      expect(election.finalized).toBe(true);
    });
  });

  describe("error normalization against a real revert", () => {
    it("finalizing an already-finalized election surfaces a real, decoded CONTRACT_REVERT", async () => {
      // Depends on the "writes" describe block above having already
      // finalized this election - intentional ordering within this file
      // (vitest runs it/describe blocks in declaration order within a
      // single file by default), not a hidden cross-file dependency.
      expect.assertions(4);
      try {
        await electionClient.finalizeElection(chain.electionId);
      } catch (error) {
        expect(error).toBeInstanceOf(BlockchainError);
        expect((error as InstanceType<typeof BlockchainError>).kind).toBe("CONTRACT_REVERT");
        expect((error as InstanceType<typeof BlockchainError>).retryable).toBe(false);
        expect((error as InstanceType<typeof BlockchainError>).revertErrorName).toBe("ElectionAlreadyFinalized");
      }
    });

    it("registering the same voter twice surfaces a real, decoded CONTRACT_REVERT", async () => {
      await voterRegistryClient.registerVoter(chain.electionId, chain.unregisteredVoterAddress);

      expect.assertions(4);
      try {
        await voterRegistryClient.registerVoter(chain.electionId, chain.unregisteredVoterAddress);
      } catch (error) {
        expect(error).toBeInstanceOf(BlockchainError);
        expect((error as InstanceType<typeof BlockchainError>).kind).toBe("CONTRACT_REVERT");
        expect((error as InstanceType<typeof BlockchainError>).retryable).toBe(false);
        expect((error as InstanceType<typeof BlockchainError>).revertErrorName).toBe("AlreadyRegistered");
      }
    });
  });
});