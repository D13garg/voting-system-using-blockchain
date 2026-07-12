// Tests for the Election module (Phase 5).
//
// Uses a REAL in-memory MongoDB (mongodb-memory-server - same
// network-restriction caveat as test/auth/auth.test.ts, see that file's
// header comment) and a FAKE IElectionContractClient test double instead
// of a real chain - this is exactly the testability purpose that
// interface's own header comment describes (HANDOFF.md's Phase 3
// section), injected via blockchain/index.ts's
// _setElectionContractClientForTests seam. Real HTTP requests via
// supertest against a real buildApp() instance, real SIWE-authenticated
// sessions (not a bypassed/mocked auth check) for the routes that
// require one - same pattern as test/auth/auth.test.ts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type {
  CandidateData,
  ElectionData,
  IElectionContractClient,
  IVoterRegistryContractClient,
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

/** Minimal fake IElectionContractClient - real chain data lives in the `elections` map, mutable per-test. */
class FakeElectionContractClient implements IElectionContractClient {
  elections = new Map<bigint, ElectionData>();

  async getElection(electionId: bigint): Promise<ElectionData> {
    const data = this.elections.get(electionId);
    if (!data) {
      const { BlockchainError } = await import("../../src/modules/blockchain/index.js");
      throw new BlockchainError({
        kind: "CONTRACT_REVERT",
        message: "Contract reverted: ElectionDoesNotExist",
        revertErrorName: "ElectionDoesNotExist",
        retryable: false,
        cause: undefined,
      });
    }
    return data;
  }

  getCandidate(): Promise<CandidateData> {
    throw new Error("not used by these tests");
  }

  async hasVoted(): Promise<boolean> {
    return false;
  }

  async electionCount(): Promise<bigint> {
    return BigInt(this.elections.size);
  }

  async isPaused(): Promise<boolean> {
    return false;
  }

  finalizeElection(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }

  /** Mutable per-test - see requireRole's "check both contracts, OR" design. Defaults to true (admin). */
  hasRoleResult = true;

  async hasRole(): Promise<boolean> {
    return this.hasRoleResult;
  }
}

/**
 * Minimal fake IVoterRegistryContractClient - election.routes.ts's admin
 * endpoints don't call anything on this interface directly, but
 * requireRole (auth.roles.middleware.ts) checks BOTH contracts' hasRole
 * and ORs the result (approved design fork - see that file's header
 * comment), so a fake is needed here too, or these tests would hit a
 * real (unreachable in-sandbox) RPC call via the lazily-constructed
 * default VoterRegistryContractClient.
 */
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
let fakeClient: FakeElectionContractClient;
let fakeVoterRegistryClient: FakeVoterRegistryContractClient;
let ElectionMetadataModel: typeof import("../../src/modules/election/election.model.js").ElectionMetadataModel;
let IndexedElectionModel: typeof import("../../src/modules/indexing/indexedElection.model.js").IndexedElectionModel;
let SESSION_COOKIE_NAME: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const blockchain = await import("../../src/modules/blockchain/index.js");
  const electionModel = await import("../../src/modules/election/election.model.js");
  const indexedElectionModel = await import("../../src/modules/indexing/indexedElection.model.js");
  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

  ElectionMetadataModel = electionModel.ElectionMetadataModel;
  IndexedElectionModel = indexedElectionModel.IndexedElectionModel;
  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;

  fakeClient = new FakeElectionContractClient();
  blockchain._setElectionContractClientForTests(fakeClient);

  fakeVoterRegistryClient = new FakeVoterRegistryContractClient();
  blockchain._setVoterRegistryContractClientForTests(fakeVoterRegistryClient);

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  fakeClient.elections.clear();
  fakeClient.hasRoleResult = true;
  fakeVoterRegistryClient.hasRoleResult = false;
});

afterEach(async () => {
  await ElectionMetadataModel.deleteMany({});
  await IndexedElectionModel.deleteMany({});
});

/**
 * Seeds a fully-synced IndexedElection mirror document, simulating the
 * worker having already processed that election's ElectionCreated (and
 * optionally CandidateAdded/ElectionFinalized) events - see
 * election.service.ts's fetchMirroredElection, which is what these
 * tests exercise instead of the old fakeClient.elections live-read path.
 */
async function seedMirror(params: {
  electionId: number;
  title: string;
  startTime: number;
  endTime: number;
  finalized?: boolean;
  finalizedBy?: string;
  candidateIds?: number[];
}): Promise<void> {
  await IndexedElectionModel.create({
    electionId: params.electionId,
    title: params.title,
    startTime: BigInt(params.startTime),
    endTime: BigInt(params.endTime),
    creator: "0xdead000000000000000000000000000000dead",
    finalized: params.finalized ?? false,
    finalizedBy: params.finalizedBy ?? null,
    candidateIds: params.candidateIds ?? [],
  });
}

/** Backdates an ElectionMetadata doc's updatedAt, bypassing Mongoose's automatic timestamp management - simulates "linked a while ago", for the ELECTION_STATE_MISMATCH-vs-ELECTION_SYNC_PENDING grace-window tests. */
async function backdateUpdatedAt(docId: string, msAgo: number): Promise<void> {
  await ElectionMetadataModel.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(docId) },
    { $set: { updatedAt: new Date(Date.now() - msAgo) } },
  );
}

/** Full real SIWE flow -> a valid session cookie, for routes gated by requireAuth. */
async function getAuthenticatedCookie(): Promise<{ cookie: string; address: string }> {
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

describe("Election module - GET /elections", () => {
  it("returns an empty list when no elections exist", async () => {
    const res = await request(app).get("/elections");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ elections: [] });
  });

  it("returns a draft election with state 'draft' and no on-chain fields", async () => {
    await ElectionMetadataModel.create({
      title: "Student Council 2026",
      description: "Annual election",
      createdBy: "0xabc",
      electionId: null,
      linkTransactionHash: null,
    });

    const res = await request(app).get("/elections");
    expect(res.status).toBe(200);
    expect(res.body.elections).toHaveLength(1);
    expect(res.body.elections[0]).toMatchObject({
      title: "Student Council 2026",
      state: "draft",
      electionId: null,
    });
    expect(res.body.elections[0].startTime).toBeUndefined();
  });

  it("merges a linked election with mirrored on-chain data and computes 'voting_active' state", async () => {
    const now = Math.floor(Date.now() / 1000);
    await seedMirror({
      electionId: 0,
      title: "On-Chain Title",
      startTime: now - 3600,
      endTime: now + 3600,
      candidateIds: [0, 1],
    });
    await ElectionMetadataModel.create({
      title: "Draft Title",
      description: "desc",
      createdBy: "0xabc",
      electionId: 0,
      linkTransactionHash: "0x" + "a".repeat(64),
    });

    const res = await request(app).get("/elections");
    expect(res.status).toBe(200);
    expect(res.body.elections[0]).toMatchObject({
      title: "On-Chain Title", // mirrored on-chain title wins once linked
      state: "voting_active",
      electionId: 0,
      finalized: false,
      candidateCount: 2,
    });
  });

  it("computes 'result_finalized' state once the mirror reports finalized", async () => {
    await seedMirror({
      electionId: 0,
      title: "Finalized Election",
      startTime: 1,
      endTime: 2,
      finalized: true,
      finalizedBy: "0xdead000000000000000000000000000000dead",
      candidateIds: [0],
    });
    await ElectionMetadataModel.create({
      title: "Draft Title",
      description: "desc",
      createdBy: "0xabc",
      electionId: 0,
      linkTransactionHash: "0x" + "a".repeat(64),
    });

    const res = await request(app).get("/elections");
    expect(res.body.elections[0].state).toBe("result_finalized");
  });

  it("returns 503 ELECTION_SYNC_PENDING when the mirror hasn't caught up yet and the link is recent", async () => {
    // No IndexedElection doc seeded at all - simulates the worker not
    // having processed ElectionCreated yet, moments after linking.
    const draft = await ElectionMetadataModel.create({
      title: "Draft Title",
      description: "desc",
      createdBy: "0xabc",
      electionId: 7,
      linkTransactionHash: "0x" + "a".repeat(64),
    });

    const res = await request(app).get(`/elections/${draft._id.toString()}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ELECTION_SYNC_PENDING");
  });

  it("returns 404 ELECTION_STATE_MISMATCH when the mirror still has no record well past the grace window", async () => {
    const draft = await ElectionMetadataModel.create({
      title: "Draft Title",
      description: "desc",
      createdBy: "0xabc",
      electionId: 7,
      linkTransactionHash: "0x" + "a".repeat(64),
    });
    // Backdate past MIRROR_SYNC_GRACE_MS (2x the 15s poll interval = 30s)
    // so this reads as "genuinely missing", not "still syncing".
    await backdateUpdatedAt(draft._id.toString(), 60_000);

    const res = await request(app).get(`/elections/${draft._id.toString()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_STATE_MISMATCH");
  });

  it("returns a partially-synced mirror (CandidateAdded processed before ElectionCreated) the same as no mirror at all", async () => {
    // Simulates the documented out-of-order case from
    // indexedElection.model.ts's header comment: a document that exists
    // but is missing `title` (only CandidateAdded has landed so far)
    // must be treated as "not yet found", not partially returned.
    await IndexedElectionModel.create({
      electionId: 7,
      finalized: false,
      candidateIds: [0],
    });
    const draft = await ElectionMetadataModel.create({
      title: "Draft Title",
      description: "desc",
      createdBy: "0xabc",
      electionId: 7,
      linkTransactionHash: "0x" + "a".repeat(64),
    });

    const res = await request(app).get(`/elections/${draft._id.toString()}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ELECTION_SYNC_PENDING");
  });
});

describe("Election module - GET /elections/:id", () => {
  it("returns 404 for an id that doesn't exist", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/elections/${fakeId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });
});

describe("Election module - POST /elections/draft", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).post("/elections/draft").send({ title: "X", description: "Y" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400 from zod validation, not 500", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).post("/elections/draft").set("Cookie", cookie).send({ description: "no title" });
    expect(res.status).toBe(400);
  });

  it("creates a draft for an authenticated wallet", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/draft")
      .set("Cookie", cookie)
      .send({ title: "New Election", description: "First draft" });

    expect(res.status).toBe(201);
    expect(res.body.election).toMatchObject({
      title: "New Election",
      description: "First draft",
      state: "draft",
      electionId: null,
      createdBy: address,
    });

    const stored = await ElectionMetadataModel.findOne({ title: "New Election" });
    expect(stored).not.toBeNull();
  });

  it("returns 403 FORBIDDEN_ROLE when the wallet holds ELECTION_ADMINISTRATOR_ROLE on neither contract", async () => {
    fakeClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = false;
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/draft")
      .set("Cookie", cookie)
      .send({ title: "Should Be Blocked", description: "" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("allows the request when the wallet holds the role on VoterRegistry only, not Election (OR semantics)", async () => {
    fakeClient.hasRoleResult = false;
    fakeVoterRegistryClient.hasRoleResult = true;
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/draft")
      .set("Cookie", cookie)
      .send({ title: "Allowed Via VoterRegistry Role", description: "" });

    expect(res.status).toBe(201);
  });
});

describe("Election module - PATCH /elections/draft/:id/link-onchain", () => {
  it("links a draft to a real on-chain election", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    const draft = await ElectionMetadataModel.create({
      title: "Draft",
      description: "desc",
      createdBy: address,
      electionId: null,
      linkTransactionHash: null,
    });
    const now = Math.floor(Date.now() / 1000);
    fakeClient.elections.set(5n, {
      title: "Draft",
      startTime: BigInt(now + 100),
      endTime: BigInt(now + 200),
      finalized: false,
      creator: address as `0x${string}`,
      candidateCount: 0n,
    });

    const res = await request(app)
      .patch(`/elections/draft/${draft._id.toString()}/link-onchain`)
      .set("Cookie", cookie)
      .send({ electionId: 5, transactionHash: "0x" + "b".repeat(64) });

    expect(res.status).toBe(200);
    expect(res.body.election).toMatchObject({ electionId: 5, state: "voting_scheduled" });

    const stored = await ElectionMetadataModel.findById(draft._id);
    expect(stored?.electionId).toBe(5);
  });

  it("returns 422 when the electionId doesn't exist on-chain yet", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    const draft = await ElectionMetadataModel.create({
      title: "Draft",
      description: "desc",
      createdBy: address,
      electionId: null,
      linkTransactionHash: null,
    });

    const res = await request(app)
      .patch(`/elections/draft/${draft._id.toString()}/link-onchain`)
      .set("Cookie", cookie)
      .send({ electionId: 99, transactionHash: "0x" + "c".repeat(64) });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ONCHAIN_ELECTION_NOT_FOUND");
  });

  it("returns 409 when the draft is already linked", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    fakeClient.elections.set(1n, {
      title: "Draft",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: address as `0x${string}`,
      candidateCount: 0n,
    });
    const draft = await ElectionMetadataModel.create({
      title: "Draft",
      description: "desc",
      createdBy: address,
      electionId: 1,
      linkTransactionHash: "0x" + "a".repeat(64),
    });

    const res = await request(app)
      .patch(`/elections/draft/${draft._id.toString()}/link-onchain`)
      .set("Cookie", cookie)
      .send({ electionId: 1, transactionHash: "0x" + "d".repeat(64) });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ELECTION_ALREADY_LINKED");
  });
});