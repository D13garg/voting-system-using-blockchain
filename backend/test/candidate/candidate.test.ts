// Tests for the Candidate module (Phase 5) - off-chain bio enrichment
// for on-chain candidates.
//
// Same testing approach as the other domain modules: real in-memory
// MongoDB, a fake IElectionContractClient test double instead of a real
// chain, real HTTP requests via supertest, real SIWE-authenticated
// sessions for the auth-gated route.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { CandidateData, ElectionData, IElectionContractClient, TransactionResult } from "../../src/modules/blockchain/index.js";

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

/** Fake IElectionContractClient - same shape as election.test.ts's/voting.test.ts's, own copy per that established convention. */
class FakeElectionContractClient implements IElectionContractClient {
  elections = new Map<bigint, ElectionData>();
  candidates = new Map<string, CandidateData>();

  private candidateKey(electionId: bigint, candidateId: bigint): string {
    return `${electionId.toString()}:${candidateId.toString()}`;
  }

  setCandidate(electionId: bigint, candidateId: bigint, data: CandidateData): void {
    this.candidates.set(this.candidateKey(electionId, candidateId), data);
  }

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

  async getCandidate(electionId: bigint, candidateId: bigint): Promise<CandidateData> {
    const data = this.candidates.get(this.candidateKey(electionId, candidateId));
    if (!data) {
      const { BlockchainError } = await import("../../src/modules/blockchain/index.js");
      throw new BlockchainError({
        kind: "CONTRACT_REVERT",
        message: "Contract reverted: CandidateDoesNotExist",
        revertErrorName: "CandidateDoesNotExist",
        retryable: false,
        cause: undefined,
      });
    }
    return data;
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
}

let mongod: MongoMemoryServer;
let app: Express;
let fakeClient: FakeElectionContractClient;
let CandidateProfileModel: typeof import("../../src/modules/candidate/candidate.model.js").CandidateProfileModel;
let IndexedElectionModel: typeof import("../../src/modules/indexing/indexedElection.model.js").IndexedElectionModel;
let IndexedCandidateModel: typeof import("../../src/modules/indexing/indexedCandidate.model.js").IndexedCandidateModel;
let SESSION_COOKIE_NAME: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const blockchain = await import("../../src/modules/blockchain/index.js");
  const candidateModel = await import("../../src/modules/candidate/candidate.model.js");
  const indexedElectionModel = await import("../../src/modules/indexing/indexedElection.model.js");
  const indexedCandidateModel = await import("../../src/modules/indexing/indexedCandidate.model.js");
  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

  CandidateProfileModel = candidateModel.CandidateProfileModel;
  IndexedElectionModel = indexedElectionModel.IndexedElectionModel;
  IndexedCandidateModel = indexedCandidateModel.IndexedCandidateModel;
  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;

  fakeClient = new FakeElectionContractClient();
  blockchain._setElectionContractClientForTests(fakeClient);

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(() => {
  fakeClient.elections.clear();
  fakeClient.candidates.clear();
});

afterEach(async () => {
  await CandidateProfileModel.deleteMany({});
  await IndexedElectionModel.deleteMany({});
  await IndexedCandidateModel.deleteMany({});
});

/**
 * Seeds a fully-synced election+candidates mirror, simulating the worker
 * having already processed ElectionCreated and however many
 * CandidateAdded events - see candidate.service.ts's listCandidates,
 * which is what these tests exercise instead of the old
 * fakeClient.elections/setCandidate live-read path. (setCandidateProfile
 * still uses the live fakeClient - that read deliberately did not
 * migrate, see candidate.service.ts's header comment.)
 */
async function seedCandidateMirror(
  electionId: number,
  candidates: { candidateId: number; name: string; metadataURI: string }[],
): Promise<void> {
  await IndexedElectionModel.create({
    electionId,
    title: "Student Council",
    startTime: 1n,
    endTime: 2n,
    creator: "0xdead000000000000000000000000000000dead",
    finalized: false,
    candidateIds: candidates.map((c) => c.candidateId),
  });
  await IndexedCandidateModel.insertMany(
    candidates.map((c) => ({ electionId, candidateId: c.candidateId, name: c.name, metadataURI: c.metadataURI })),
  );
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

function futureElection(overrides: Partial<ElectionData> = {}): ElectionData {
  const now = Math.floor(Date.now() / 1000);
  return {
    title: "Student Council",
    startTime: BigInt(now + 3600),
    endTime: BigInt(now + 7200),
    finalized: false,
    creator: "0xdead000000000000000000000000000000dead",
    candidateCount: 0n,
    ...overrides,
  };
}

function startedElection(overrides: Partial<ElectionData> = {}): ElectionData {
  const now = Math.floor(Date.now() / 1000);
  return {
    title: "Student Council",
    startTime: BigInt(now - 3600),
    endTime: BigInt(now + 3600),
    finalized: false,
    creator: "0xdead000000000000000000000000000000dead",
    candidateCount: 0n,
    ...overrides,
  };
}

describe("Candidate module - GET /elections/:id/candidates", () => {
  it("returns 404 for an electionId that doesn't exist in the mirror", async () => {
    const res = await request(app).get("/elections/99/candidates");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });

  it("returns candidates with bio: null when no profile has been set", async () => {
    await seedCandidateMirror(0, [
      { candidateId: 0, name: "Alice", metadataURI: "ipfs://alice" },
      { candidateId: 1, name: "Bob", metadataURI: "ipfs://bob" },
    ]);

    const res = await request(app).get("/elections/0/candidates");
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([
      { candidateId: 0, name: "Alice", metadataURI: "ipfs://alice", bio: null, imageUrl: "https://w3s.link/ipfs/ipfs://alice" },
      { candidateId: 1, name: "Bob", metadataURI: "ipfs://bob", bio: null, imageUrl: "https://w3s.link/ipfs/ipfs://bob" },
    ]);
  });

  it("merges in a bio once one has been set", async () => {
    await seedCandidateMirror(0, [{ candidateId: 0, name: "Alice", metadataURI: "ipfs://alice" }]);
    await CandidateProfileModel.create({ electionId: 0, candidateId: 0, bio: "Loves debate club.", updatedBy: "0xadmin" });

    const res = await request(app).get("/elections/0/candidates");
    expect(res.status).toBe(200);
    expect(res.body.candidates[0]).toEqual({
      candidateId: 0,
      name: "Alice",
      metadataURI: "ipfs://alice",
      bio: "Loves debate club.",
      imageUrl: "https://w3s.link/ipfs/ipfs://alice",
    });
  });

  it("skips a candidateId present in IndexedElection but not yet in IndexedCandidate (partial-write edge case, self-corrects on the worker's next pass)", async () => {
    await IndexedElectionModel.create({
      electionId: 0,
      title: "Student Council",
      startTime: 1n,
      endTime: 2n,
      creator: "0xdead000000000000000000000000000000dead",
      finalized: false,
      candidateIds: [0, 1], // 2 registered...
    });
    await IndexedCandidateModel.create({ electionId: 0, candidateId: 0, name: "Alice", metadataURI: "ipfs://alice" });
    // ...but only 1 identity doc exists yet - simulates a crash between
    // eventSync.ts's two awaited writes for the same CandidateAdded log.

    const res = await request(app).get("/elections/0/candidates");
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([
      { candidateId: 0, name: "Alice", metadataURI: "ipfs://alice", bio: null, imageUrl: "https://w3s.link/ipfs/ipfs://alice" },
    ]);
  });
});

describe("Candidate module - PUT /elections/:id/candidates/:candidateId/profile", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).put("/elections/0/candidates/0/profile").send({ bio: "Hi" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400 from zod validation, not 500", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).put("/elections/0/candidates/0/profile").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when the election doesn't exist on-chain", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).put("/elections/99/candidates/0/profile").set("Cookie", cookie).send({ bio: "Hi" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });

  it("returns 404 when the candidate doesn't exist on-chain", async () => {
    fakeClient.elections.set(0n, futureElection({ candidateCount: 0n }));
    const { cookie } = await getAuthenticatedCookie();

    const res = await request(app).put("/elections/0/candidates/0/profile").set("Cookie", cookie).send({ bio: "Hi" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CANDIDATE_NOT_FOUND");
  });

  it("sets a bio for a candidate in an election that hasn't started yet", async () => {
    fakeClient.elections.set(0n, futureElection({ candidateCount: 1n }));
    fakeClient.setCandidate(0n, 0n, { name: "Alice", metadataURI: "ipfs://alice", voteCount: 0n });
    const { cookie, address } = await getAuthenticatedCookie();

    const res = await request(app)
      .put("/elections/0/candidates/0/profile")
      .set("Cookie", cookie)
      .send({ bio: "Loves debate club." });

    expect(res.status).toBe(200);
    expect(res.body.candidate).toEqual({
      candidateId: 0,
      name: "Alice",
      metadataURI: "ipfs://alice",
      bio: "Loves debate club.",
      imageUrl: "https://w3s.link/ipfs/ipfs://alice",
    });

    const stored = await CandidateProfileModel.findOne({ electionId: 0, candidateId: 0 });
    expect(stored).toMatchObject({ bio: "Loves debate club.", updatedBy: address });
  });

  it("overwrites an existing bio rather than creating a duplicate", async () => {
    fakeClient.elections.set(0n, futureElection({ candidateCount: 1n }));
    fakeClient.setCandidate(0n, 0n, { name: "Alice", metadataURI: "ipfs://alice", voteCount: 0n });
    const { cookie } = await getAuthenticatedCookie();

    await request(app).put("/elections/0/candidates/0/profile").set("Cookie", cookie).send({ bio: "First bio." });
    await request(app).put("/elections/0/candidates/0/profile").set("Cookie", cookie).send({ bio: "Updated bio." });

    const count = await CandidateProfileModel.countDocuments({ electionId: 0, candidateId: 0 });
    expect(count).toBe(1);
    const stored = await CandidateProfileModel.findOne({ electionId: 0, candidateId: 0 });
    expect(stored?.bio).toBe("Updated bio.");
  });

  it("returns 409 once voting has started (approved fairness rule)", async () => {
    fakeClient.elections.set(0n, startedElection({ candidateCount: 1n }));
    fakeClient.setCandidate(0n, 0n, { name: "Alice", metadataURI: "ipfs://alice", voteCount: 0n });
    const { cookie } = await getAuthenticatedCookie();

    const res = await request(app).put("/elections/0/candidates/0/profile").set("Cookie", cookie).send({ bio: "Too late." });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANDIDATE_PROFILE_LOCKED");

    const stored = await CandidateProfileModel.findOne({ electionId: 0, candidateId: 0 });
    expect(stored).toBeNull();
  });
});