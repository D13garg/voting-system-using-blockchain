// Tests for the Voting module (Phase 5).
//
// Same testing approach as test/election/election.test.ts: real
// in-memory MongoDB (needed only because buildApp() wires up Auth, which
// this module's has-voted route depends on via requireAuth - Voting
// itself has no Mongoose model of its own, see voting.types.ts's header
// comment), a fake IElectionContractClient test double instead of a real
// chain, real HTTP requests via supertest, real SIWE-authenticated
// sessions for the auth-gated route.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { CandidateData, ElectionData, IElectionContractClient, TransactionResult } from "../../src/modules/blockchain/index.js";
import { IndexedVoteEventModel } from "../../src/modules/indexing/indexedVoteEvent.model.js";

/**
 * Seeds `count` distinct IndexedVoteEvent documents for one candidate -
 * distinct txHash per document since {txHash, logIndex} is the unique
 * idempotency key (see indexedVoteEvent.model.ts's header comment).
 * voterAddress/blockNumber/timestamp are irrelevant to the tally
 * aggregation itself, so fixed placeholder values are fine here.
 */
async function seedVotes(electionId: number, candidateId: number, count: number): Promise<void> {
  const docs = Array.from({ length: count }, (_, i) => ({
    electionId,
    candidateId,
    voterAddress: `0x${"1".repeat(39)}${i % 10}`,
    txHash: `0x${electionId}${candidateId}${i}${"0".repeat(50)}`,
    logIndex: i,
    blockNumber: BigInt(i + 1),
    timestamp: new Date(),
  }));
  await IndexedVoteEventModel.insertMany(docs);
}

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

/**
 * Fake IElectionContractClient - same shape as election.test.ts's, kept
 * as a separate copy rather than shared/imported: each test file runs in
 * its own vitest worker process with its own module graph (see
 * election.test.ts's header comment on why app.ts needed the
 * NODE_ENV-guard fix), and a two-line duplicate is cheaper than adding a
 * shared-test-utility module for a fake this small.
 */
class FakeElectionContractClient implements IElectionContractClient {
  elections = new Map<bigint, ElectionData>();
  candidates = new Map<string, CandidateData>();
  votedVoters = new Set<string>();

  private candidateKey(electionId: bigint, candidateId: bigint): string {
    return `${electionId.toString()}:${candidateId.toString()}`;
  }

  setCandidate(electionId: bigint, candidateId: bigint, data: CandidateData): void {
    this.candidates.set(this.candidateKey(electionId, candidateId), data);
  }

  setVoted(electionId: bigint, voter: `0x${string}`): void {
    this.votedVoters.add(`${electionId.toString()}:${voter.toLowerCase()}`);
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
    if (!data) throw new Error(`test setup error: no candidate ${candidateId} for election ${electionId}`);
    return data;
  }

  async hasVoted(electionId: bigint, voter: `0x${string}`): Promise<boolean> {
    return this.votedVoters.has(`${electionId.toString()}:${voter.toLowerCase()}`);
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
let SESSION_COOKIE_NAME: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const blockchain = await import("../../src/modules/blockchain/index.js");
  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

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

beforeEach(async () => {
  fakeClient.elections.clear();
  fakeClient.candidates.clear();
  fakeClient.votedVoters.clear();
  await IndexedVoteEventModel.deleteMany({});
});

/** Full real SIWE flow -> a valid session cookie, same helper as election.test.ts. */
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

describe("Voting module - GET /elections/:id/results", () => {
  it("returns 404 for an electionId that doesn't exist on-chain", async () => {
    const res = await request(app).get("/elections/99/results");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });

  it("returns a per-candidate tally summing to the correct total, sourced from IndexedVoteEvent", async () => {
    fakeClient.elections.set(0n, {
      title: "Student Council",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: "0xdead000000000000000000000000000000dead",
      candidateCount: 2n,
    });
    // Deliberately mismatched from the seeded IndexedVoteEvent counts
    // below - see the next test, which asserts these values are ignored.
    fakeClient.setCandidate(0n, 0n, { name: "Alice", metadataURI: "ipfs://alice", voteCount: 999n });
    fakeClient.setCandidate(0n, 1n, { name: "Bob", metadataURI: "ipfs://bob", voteCount: 999n });
    await seedVotes(0, 0, 7);
    await seedVotes(0, 1, 3);

    const res = await request(app).get("/elections/0/results");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual({
      electionId: 0,
      totalVotes: 10,
      candidates: [
        { candidateId: 0, name: "Alice", metadataURI: "ipfs://alice", voteCount: 7 },
        { candidateId: 1, name: "Bob", metadataURI: "ipfs://bob", voteCount: 3 },
      ],
    });
  });

  it("ignores the chain's own candidate.voteCount entirely - the tally is sourced only from IndexedVoteEvent (decision (a) migration)", async () => {
    fakeClient.elections.set(0n, {
      title: "Student Council",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: "0xdead000000000000000000000000000000dead",
      candidateCount: 1n,
    });
    // A large, obviously-wrong on-chain voteCount that would fail this
    // assertion immediately if the old live-read code path were still in
    // use - proves the migration actually took effect, not just that the
    // happy-path numbers coincidentally still match.
    fakeClient.setCandidate(0n, 0n, { name: "Alice", metadataURI: "ipfs://alice", voteCount: 123456n });
    await seedVotes(0, 0, 2);

    const res = await request(app).get("/elections/0/results");
    expect(res.status).toBe(200);
    expect(res.body.results.candidates[0].voteCount).toBe(2);
    expect(res.body.results.totalVotes).toBe(2);
  });

  it("scopes the tally to the requested electionId - votes from a different election never leak in", async () => {
    fakeClient.elections.set(0n, {
      title: "Student Council",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: "0xdead000000000000000000000000000000dead",
      candidateCount: 1n,
    });
    fakeClient.setCandidate(0n, 0n, { name: "Alice", metadataURI: "ipfs://alice", voteCount: 0n });
    await seedVotes(0, 0, 4);
    // Same candidateId, different election - must not be counted above.
    await seedVotes(1, 0, 100);

    const res = await request(app).get("/elections/0/results");
    expect(res.status).toBe(200);
    expect(res.body.results.candidates[0].voteCount).toBe(4);
    expect(res.body.results.totalVotes).toBe(4);
  });

  it("returns zero candidates and zero total for an election with no candidates yet", async () => {
    fakeClient.elections.set(1n, {
      title: "Empty Election",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: "0xdead000000000000000000000000000000dead",
      candidateCount: 0n,
    });

    const res = await request(app).get("/elections/1/results");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual({ electionId: 1, totalVotes: 0, candidates: [] });
  });
});

describe("Voting module - GET /elections/:id/has-voted", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/elections/0/has-voted");
    expect(res.status).toBe(401);
  });

  it("returns 404 for an electionId that doesn't exist on-chain, even when authenticated", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/elections/99/has-voted").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });

  it("returns hasVoted: false for a wallet that hasn't voted", async () => {
    fakeClient.elections.set(0n, {
      title: "Student Council",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: "0xdead000000000000000000000000000000dead",
      candidateCount: 0n,
    });
    const { cookie, address } = await getAuthenticatedCookie();

    const res = await request(app).get("/elections/0/has-voted").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toEqual({ electionId: 0, address, hasVoted: false });
  });

  it("returns hasVoted: true for a wallet the fake client has recorded as voted", async () => {
    fakeClient.elections.set(0n, {
      title: "Student Council",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: "0xdead000000000000000000000000000000dead",
      candidateCount: 0n,
    });
    const { cookie, address } = await getAuthenticatedCookie();
    fakeClient.setVoted(0n, address);

    const res = await request(app).get("/elections/0/has-voted").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toEqual({ electionId: 0, address, hasVoted: true });
  });

  it("only reports the authenticated wallet's own status, not an arbitrary address (approved design fork)", async () => {
    fakeClient.elections.set(0n, {
      title: "Student Council",
      startTime: BigInt(1),
      endTime: BigInt(2),
      finalized: false,
      creator: "0xdead000000000000000000000000000000dead",
      candidateCount: 0n,
    });
    const { cookie, address } = await getAuthenticatedCookie();
    const someoneElse = privateKeyToAccount(generatePrivateKey()).address;
    fakeClient.setVoted(0n, someoneElse);

    // Even though a query param is passed, the route only ever reads
    // res.locals.auth.address (the session's own wallet) - the route
    // implementation ignores any address supplied by the caller.
    const res = await request(app).get(`/elections/0/has-voted?address=${someoneElse}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toEqual({ electionId: 0, address, hasVoted: false });
  });
});