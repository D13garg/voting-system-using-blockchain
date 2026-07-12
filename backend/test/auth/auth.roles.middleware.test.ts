// Unit tests for requireRole (auth.roles.middleware.ts) - the real
// on-chain-role-enforcement gate for admin-facing write endpoints
// (HANDOFF.md's "Newly discovered pre-frontend items", item 1).
//
// Deliberately a tiny standalone Express app, same pattern as
// test/middleware/rateLimiter.test.ts's own header comment explains:
// this is unit-testing the middleware's own behavior (both-contracts-OR
// semantics, 401 when requireRole is wired without an upstream auth
// step, 403 shape, propagating a downstream BlockchainError as 500
// rather than swallowing it) in isolation, not integrating with a real
// domain module's routes or a real Mongo-backed session. No real RPC
// call is ever made - both contract clients are injected fakes via the
// same _set*ContractClientForTests seams every other domain module's
// tests use.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import type {
  IElectionContractClient,
  IVoterRegistryContractClient,
  ElectionData,
  CandidateData,
  TransactionResult,
} from "../../src/modules/blockchain/index.js";

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
};

const SOME_ROLE = ("0x" + "a".repeat(64)) as `0x${string}`;
const TEST_ADDRESS = "0x1111111111111111111111111111111111111111" as `0x${string}`;

class FakeElectionContractClient implements IElectionContractClient {
  hasRoleResult = false;
  hasRoleError: Error | undefined;
  calls: Array<{ role: string; account: string }> = [];

  getElection(): Promise<ElectionData> {
    throw new Error("not used by these tests");
  }
  getCandidate(): Promise<CandidateData> {
    throw new Error("not used by these tests");
  }
  hasVoted(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  electionCount(): Promise<bigint> {
    throw new Error("not used by these tests");
  }
  isPaused(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  finalizeElection(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  async hasRole(role: `0x${string}`, account: `0x${string}`): Promise<boolean> {
    this.calls.push({ role, account });
    if (this.hasRoleError) throw this.hasRoleError;
    return this.hasRoleResult;
  }
}

class FakeVoterRegistryContractClient implements IVoterRegistryContractClient {
  hasRoleResult = false;
  calls: Array<{ role: string; account: string }> = [];

  isRegisteredForElection(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  registerVoter(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  removeVoter(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  async hasRole(role: `0x${string}`, account: `0x${string}`): Promise<boolean> {
    this.calls.push({ role, account });
    return this.hasRoleResult;
  }
}

let requireRole: typeof import("../../src/modules/auth/auth.roles.middleware.js").requireRole;
let errorHandler: typeof import("../../src/middleware/errorHandler.js").errorHandler;
let setElectionClient: typeof import("../../src/modules/blockchain/index.js")._setElectionContractClientForTests;
let setVoterRegistryClient: typeof import("../../src/modules/blockchain/index.js")._setVoterRegistryContractClientForTests;

let fakeElectionClient: FakeElectionContractClient;
let fakeVoterRegistryClient: FakeVoterRegistryContractClient;

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  const rolesMiddleware = await import("../../src/modules/auth/auth.roles.middleware.js");
  const errorHandlerModule = await import("../../src/middleware/errorHandler.js");
  const blockchain = await import("../../src/modules/blockchain/index.js");

  requireRole = rolesMiddleware.requireRole;
  errorHandler = errorHandlerModule.errorHandler;
  setElectionClient = blockchain._setElectionContractClientForTests;
  setVoterRegistryClient = blockchain._setVoterRegistryContractClientForTests;
});

afterEach(() => {
  setElectionClient(undefined);
  setVoterRegistryClient(undefined);
});

/** Injects res.locals.auth directly - a bare stand-in for requireAuth, since this suite unit-tests requireRole alone. */
function fakeAuth(address: string | undefined) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (address) res.locals.auth = { address, sessionId: "test-session" };
    next();
  };
}

function buildTestApp(authAddress: string | undefined): Express {
  fakeElectionClient = new FakeElectionContractClient();
  fakeVoterRegistryClient = new FakeVoterRegistryContractClient();
  setElectionClient(fakeElectionClient);
  setVoterRegistryClient(fakeVoterRegistryClient);

  const app = express();
  app.post("/protected", fakeAuth(authAddress), requireRole(SOME_ROLE), (_req, res) => res.status(200).json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("requireRole - both-contracts-OR semantics", () => {
  it("allows the request when the role is held on the Election contract only", async () => {
    const app = buildTestApp(TEST_ADDRESS);
    fakeElectionClient.hasRoleResult = true;
    fakeVoterRegistryClient.hasRoleResult = false;

    const res = await request(app).post("/protected");
    expect(res.status).toBe(200);
  });

  it("allows the request when the role is held on the VoterRegistry contract only", async () => {
    const app = buildTestApp(TEST_ADDRESS);
    fakeElectionClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = true;

    const res = await request(app).post("/protected");
    expect(res.status).toBe(200);
  });

  it("allows the request when the role is held on both contracts", async () => {
    const app = buildTestApp(TEST_ADDRESS);
    fakeElectionClient.hasRoleResult = true;
    fakeVoterRegistryClient.hasRoleResult = true;

    const res = await request(app).post("/protected");
    expect(res.status).toBe(200);
  });

  it("returns 403 FORBIDDEN_ROLE when the role is held on neither contract", async () => {
    const app = buildTestApp(TEST_ADDRESS);
    fakeElectionClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = false;

    const res = await request(app).post("/protected");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("checks both contracts with the same role and account", async () => {
    const app = buildTestApp(TEST_ADDRESS);
    fakeElectionClient.hasRoleResult = true;
    fakeVoterRegistryClient.hasRoleResult = true;

    await request(app).post("/protected");

    expect(fakeElectionClient.calls).toEqual([{ role: SOME_ROLE, account: TEST_ADDRESS }]);
    expect(fakeVoterRegistryClient.calls).toEqual([{ role: SOME_ROLE, account: TEST_ADDRESS }]);
  });
});

describe("requireRole - upstream-auth contract", () => {
  it("returns 401 UNAUTHENTICATED if wired without an upstream auth step (defensive, should not happen in real routing)", async () => {
    const app = buildTestApp(undefined);

    const res = await request(app).post("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(fakeElectionClient.calls).toHaveLength(0);
    expect(fakeVoterRegistryClient.calls).toHaveLength(0);
  });
});

describe("requireRole - error propagation", () => {
  it("propagates a downstream contract-client error to the error handler rather than treating it as a denial", async () => {
    const app = buildTestApp(TEST_ADDRESS);
    fakeElectionClient.hasRoleError = new Error("simulated RPC failure");

    const res = await request(app).post("/protected");
    expect(res.status).toBe(500);
  });
});