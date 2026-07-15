// Tests for the Admin module (Phase 5) - registration approval workflow.
//
// Same testing approach as the other domain modules: real in-memory
// MongoDB, real HTTP requests via supertest, real SIWE-authenticated
// sessions. Domain reads never call the chain live - onChainConfirmed is
// seeded directly via IndexedVoterRegistrationModel (simulating the
// worker having already processed the relevant
// VoterRegistered/VoterRemoved events), same approach as
// election.test.ts's seedMirror helper. A minimal fake
// IElectionContractClient/IVoterRegistryContractClient pair IS needed
// again as of the on-chain-role-enforcement gap (HANDOFF.md's "Newly
// discovered pre-frontend items", item 1) - the approve/reject endpoints
// now call requireRole, which checks hasRole() on both contracts, so
// these tests need something other than a real (in-sandbox-unreachable)
// RPC call to answer that check. Role-check-only fakes, not full
// re-implementations - nothing else in this module touches either
// interface.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
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
  REDIS_URL: "redis://localhost:6379",
  IPFS_API_KEY: "test-ipfs-key",
  IPFS_API_SECRET: "test-ipfs-secret",
  RESEND_API_KEY: "test-resend-key",
  SIWE_DOMAIN: "localhost:5173",
  SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
  FRONTEND_ORIGIN: "http://localhost:5173",
  SIWE_SESSION_TTL_SECONDS: "86400",
};

/** Role-check-only fake - see this file's header comment. Defaults to true (admin). */
class FakeElectionContractClient implements IElectionContractClient {
  hasRoleResult = true;

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
  async hasRole(): Promise<boolean> {
    return this.hasRoleResult;
  }
}

/** Role-check-only fake - see this file's header comment. Defaults to false, matching election.test.ts's/candidate.test.ts's convention. */
class FakeVoterRegistryContractClient implements IVoterRegistryContractClient {
  hasRoleResult = false;

  isRegisteredForElection(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  registerVoter(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  removeVoter(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  async hasRole(): Promise<boolean> {
    return this.hasRoleResult;
  }
}


let mongod: MongoMemoryServer;
let app: Express;
let fakeElectionClient: FakeElectionContractClient;
let fakeVoterRegistryClient: FakeVoterRegistryContractClient;
let RegistrationRequestModel: typeof import("../../src/modules/admin/admin.model.js").RegistrationRequestModel;
let IndexedVoterRegistrationModel: typeof import("../../src/modules/indexing/indexedVoterRegistration.model.js").IndexedVoterRegistrationModel;
let AuditLogModel: typeof import("../../src/modules/audit/audit.model.js").AuditLogModel;
let SESSION_COOKIE_NAME: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const blockchain = await import("../../src/modules/blockchain/index.js");
  const adminModel = await import("../../src/modules/admin/admin.model.js");
  const indexedVoterRegistrationModel = await import("../../src/modules/indexing/indexedVoterRegistration.model.js");
  const auditModelModule = await import("../../src/modules/audit/audit.model.js");
  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

  RegistrationRequestModel = adminModel.RegistrationRequestModel;
  IndexedVoterRegistrationModel = indexedVoterRegistrationModel.IndexedVoterRegistrationModel;
  AuditLogModel = auditModelModule.AuditLogModel;
  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;

  fakeElectionClient = new FakeElectionContractClient();
  blockchain._setElectionContractClientForTests(fakeElectionClient);

  fakeVoterRegistryClient = new FakeVoterRegistryContractClient();
  blockchain._setVoterRegistryContractClientForTests(fakeVoterRegistryClient);

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(() => {
  fakeElectionClient.hasRoleResult = true;
  fakeVoterRegistryClient.hasRoleResult = false;
});

afterEach(async () => {
  await RegistrationRequestModel.deleteMany({});
  await IndexedVoterRegistrationModel.deleteMany({});
  await AuditLogModel.deleteMany({});
});

/**
 * Seeds a fully-synced IndexedVoterRegistration mirror document,
 * simulating the worker having already processed a VoterRegistered (or
 * VoterRemoved) event for this (electionId, voterAddress) pair - see
 * admin.service.ts's fetchOnChainConfirmed, which is what these tests
 * exercise instead of the old fakeClient.setConfirmed live-read path.
 * Lowercases voterAddress, matching the real write path's normalization
 * (see indexedVoterRegistration.model.ts's header comment).
 */
async function seedRegistrationMirror(electionId: number, voterAddress: string, registered = true): Promise<void> {
  await IndexedVoterRegistrationModel.create({
    electionId,
    voterAddress: voterAddress.toLowerCase(),
    registered,
    lastEventBlockNumber: 1n,
    lastEventLogIndex: 0,
  });
}

/** Full real SIWE flow -> a valid session cookie, same helper as the other modules' tests. */
async function getAuthenticatedCookie(): Promise<{ cookie: string; address: `0x${string}` }> {
  const nonceRes = await request(app).post("/auth/nonce");
  const nonce = (nonceRes.body as { nonce: string }).nonce;

  const account = privateKeyToAccount(generatePrivateKey());
  const siweMessage = new SiweMessage({
    domain: REQUIRED_ENV.SIWE_DOMAIN,
    address: account.address,
    statement: "Sign in to Decentralized Voting System",
    uri: `http://${REQUIRED_ENV.SIWE_DOMAIN}`,
    version: "1",
    chainId: 31337,
    nonce,
  });
  const message = siweMessage.prepareMessage();
  const signature = await account.signMessage({ message });

  const siweRes = await request(app).post("/auth/siwe").send({ message, signature });
  const setCookie = siweRes.headers["set-cookie"] as unknown as string[];
  const cookie = setCookie.find((c) => c.startsWith(SESSION_COOKIE_NAME))!;
  return { cookie, address: account.address };
}

describe("Admin module - POST /voters/register-request", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).post("/voters/register-request").send({ electionId: 0 });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400 from zod validation, not 500", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).post("/voters/register-request").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });

  it("creates a pending request for an authenticated wallet", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    const res = await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 0 });

    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ electionId: 0, voterAddress: address, status: "pending" });
    // Wallet module wiring (item 2) - no ENS RPC configured in REQUIRED_ENV,
    // so this degrades to the checksummed address itself, not an ENS name.
    // See wallet.service.ts's toDisplayName/resolveEnsName header comments.
    expect(res.body.request.voterDisplayName).toBe(address);
  });

  it("returns 409 when a pending request already exists for the same wallet and election", async () => {
    const { cookie } = await getAuthenticatedCookie();
    await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 0 });

    const res = await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REGISTRATION_REQUEST_ALREADY_ACTIVE");
  });

  it("allows a new request after a prior one was rejected (approved design decision)", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    const firstRes = await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 0 });
    const firstId = firstRes.body.request.id as string;

    await RegistrationRequestModel.findByIdAndUpdate(firstId, {
      status: "rejected",
      reviewedBy: "0xadmin",
      reviewedAt: new Date(),
    });

    const secondRes = await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 0 });
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.request).toMatchObject({ electionId: 0, voterAddress: address, status: "pending" });
  });
});

describe("Admin module - GET /voters/me/registration/:electionId", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/voters/me/registration/0");
    expect(res.status).toBe(401);
  });

  it("returns not_requested with a mirrored onChainConfirmed check when no request exists", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    await seedRegistrationMirror(0, address);

    const res = await request(app).get("/voters/me/registration/0").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toEqual({ electionId: 0, voterAddress: address, status: "not_requested", onChainConfirmed: true });
  });

  it("returns the most recent request merged with onChainConfirmed", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 0 });

    const res = await request(app).get("/voters/me/registration/0").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toMatchObject({ electionId: 0, voterAddress: address, status: "pending", onChainConfirmed: false });
  });

  it("is case-insensitive when matching the wallet address against the mirror", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    // Seed with a DIFFERENTLY-cased address than what the session
    // reports - exercises the exact regression this migration flagged
    // (see indexedVoterRegistration.model.ts's header comment).
    await seedRegistrationMirror(0, address.toUpperCase());

    const res = await request(app).get("/voters/me/registration/0").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.status.onChainConfirmed).toBe(true);
  });
});

describe("Admin module - GET /admin/registration-requests", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/admin/registration-requests");
    expect(res.status).toBe(401);
  });

  it("lists all requests merged with a mirrored on-chain confirmation check", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 0 });
    await seedRegistrationMirror(0, address);

    const res = await request(app).get("/admin/registration-requests").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({ electionId: 0, voterAddress: address, status: "pending", onChainConfirmed: true });
  });

  it("filters by status", async () => {
    const { cookie: cookieA } = await getAuthenticatedCookie();
    const { cookie: cookieB } = await getAuthenticatedCookie();
    const resA = await request(app).post("/voters/register-request").set("Cookie", cookieA).send({ electionId: 0 });
    await request(app).post("/voters/register-request").set("Cookie", cookieB).send({ electionId: 1 });

    await request(app)
      .post(`/admin/registration-requests/${resA.body.request.id}/approve`)
      .set("Cookie", cookieA);

    const res = await request(app).get("/admin/registration-requests?status=approved").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].status).toBe("approved");
  });
});

describe("Admin module - POST /admin/registration-requests/:id/approve and /reject", () => {
  it("returns 404 for a request id that doesn't exist", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post(`/admin/registration-requests/${fakeId}/approve`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REGISTRATION_REQUEST_NOT_FOUND");
  });

  it("approves a pending request, recording the reviewer and timestamp", async () => {
    const { cookie: voterCookie } = await getAuthenticatedCookie();
    const { cookie: adminCookie, address: adminAddress } = await getAuthenticatedCookie();
    const createRes = await request(app).post("/voters/register-request").set("Cookie", voterCookie).send({ electionId: 0 });
    const requestId = createRes.body.request.id as string;

    const res = await request(app).post(`/admin/registration-requests/${requestId}/approve`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ status: "approved", reviewedBy: adminAddress, onChainConfirmed: false });
    expect(res.body.request.reviewedAt).not.toBeNull();
  });

  it("rejects a pending request", async () => {
    const { cookie: voterCookie } = await getAuthenticatedCookie();
    const { cookie: adminCookie } = await getAuthenticatedCookie();
    const createRes = await request(app).post("/voters/register-request").set("Cookie", voterCookie).send({ electionId: 0 });
    const requestId = createRes.body.request.id as string;

    const res = await request(app).post(`/admin/registration-requests/${requestId}/reject`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("rejected");
  });

  it("records a Section 17 audit entry (REGISTRATION_APPROVED) alongside the approval, with no txHash/logIndex (off-chain path)", async () => {
    const { cookie: voterCookie, address: voterAddress } = await getAuthenticatedCookie();
    const { cookie: adminCookie, address: adminAddress } = await getAuthenticatedCookie();
    const createRes = await request(app).post("/voters/register-request").set("Cookie", voterCookie).send({ electionId: 0 });
    const requestId = createRes.body.request.id as string;

    await request(app).post(`/admin/registration-requests/${requestId}/approve`).set("Cookie", adminCookie);

    const entries = await AuditLogModel.find({ category: "REGISTRATION_APPROVED" }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: "off-chain",
      actor: adminAddress,
      subject: voterAddress,
      electionId: 0,
      metadata: { requestId },
    });
    expect(entries[0]).not.toHaveProperty("txHash");
  });

  it("returns 409 when approving a request that was already reviewed", async () => {
    const { cookie: voterCookie } = await getAuthenticatedCookie();
    const { cookie: adminCookie } = await getAuthenticatedCookie();
    const createRes = await request(app).post("/voters/register-request").set("Cookie", voterCookie).send({ electionId: 0 });
    const requestId = createRes.body.request.id as string;
    await request(app).post(`/admin/registration-requests/${requestId}/approve`).set("Cookie", adminCookie);

    const res = await request(app).post(`/admin/registration-requests/${requestId}/reject`).set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REGISTRATION_REQUEST_ALREADY_REVIEWED");
  });

  it("returns 403 FORBIDDEN_ROLE when the wallet holds ELECTION_ADMINISTRATOR_ROLE on neither contract", async () => {
    const { cookie: voterCookie } = await getAuthenticatedCookie();
    const { cookie: nonAdminCookie } = await getAuthenticatedCookie();
    const createRes = await request(app).post("/voters/register-request").set("Cookie", voterCookie).send({ electionId: 0 });
    const requestId = createRes.body.request.id as string;

    fakeElectionClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = false;

    const res = await request(app).post(`/admin/registration-requests/${requestId}/approve`).set("Cookie", nonAdminCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");

    const stored = await RegistrationRequestModel.findById(requestId);
    expect(stored?.status).toBe("pending");
  });
});

// 2026-07-13 session: GET /admin/registration-requests was missing
// requireRole(ELECTION_ADMINISTRATOR_ROLE) entirely - every sibling
// write endpoint in this file already had it, this GET was the sole
// outlier. Found (and fixed) while building the frontend Registration
// Requests admin page, not by a pre-existing test - beforeEach's default
// hasRoleResult=true meant every prior test of this endpoint incidentally
// held the role anyway, so the missing check never surfaced. This
// explicit non-admin case is the regression test that would have caught
// it.
describe("Admin module - GET /admin/registration-requests now requires ELECTION_ADMINISTRATOR_ROLE (2026-07-13 fix)", () => {
  it("rejects a wallet with no admin role, even if authenticated", async () => {
    const { cookie } = await getAuthenticatedCookie();
    fakeElectionClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = false;

    const res = await request(app).get("/admin/registration-requests").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
  });
});

// GET /admin/me/role - RoleGuard's data source (frontend, 2026-07-13
// design doc). Deliberately NOT itself gated by requireRole (see the
// route's own @openapi comment) - only requireAuth, since the whole
// point is finding out whether the role is held.
describe("Admin module - GET /admin/me/role", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/admin/me/role");
    expect(res.status).toBe(401);
  });

  it("returns true when the wallet holds the role (default fake state)", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/admin/me/role").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isElectionAdministrator: true });
  });

  it("returns false when the wallet holds the role on neither contract", async () => {
    const { cookie } = await getAuthenticatedCookie();
    fakeElectionClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = false;

    const res = await request(app).get("/admin/me/role").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isElectionAdministrator: false });
  });

  it("returns true via the OR-across-both-contracts rule, even if only VoterRegistry holds it", async () => {
    const { cookie } = await getAuthenticatedCookie();
    fakeElectionClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = true;

    const res = await request(app).get("/admin/me/role").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isElectionAdministrator: true });
  });
});