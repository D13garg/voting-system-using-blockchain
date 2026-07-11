// Tests for the Analytics module (GET /analytics/:electionId,
// recomputeRollup). Real in-memory MongoDB, no Redis/BullMQ involved at
// all - recomputeRollup is called directly here (as analytics.worker.ts
// would after dequeuing a job), never through the queue, so this suite
// needs no fake queue and no Redis connection - see analytics.queue.ts's
// header comment for why that's possible.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";

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

let mongod: MongoMemoryServer;
let app: Express;
let recomputeRollup: typeof import("../../src/modules/analytics/analytics.service.js").recomputeRollup;
let IndexedElectionModel: typeof import("../../src/modules/indexing/indexedElection.model.js").IndexedElectionModel;
let IndexedVoteEventModel: typeof import("../../src/modules/indexing/indexedVoteEvent.model.js").IndexedVoteEventModel;
let IndexedVoterRegistrationModel: typeof import("../../src/modules/indexing/indexedVoterRegistration.model.js").IndexedVoterRegistrationModel;
let AnalyticsRollupModel: typeof import("../../src/modules/analytics/analytics.model.js").AnalyticsRollupModel;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const analyticsServiceModule = await import("../../src/modules/analytics/analytics.service.js");
  const analyticsModelModule = await import("../../src/modules/analytics/analytics.model.js");
  const indexedElectionModule = await import("../../src/modules/indexing/indexedElection.model.js");
  const indexedVoteEventModule = await import("../../src/modules/indexing/indexedVoteEvent.model.js");
  const indexedVoterRegistrationModule = await import("../../src/modules/indexing/indexedVoterRegistration.model.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

  recomputeRollup = analyticsServiceModule.recomputeRollup;
  AnalyticsRollupModel = analyticsModelModule.AnalyticsRollupModel;
  IndexedElectionModel = indexedElectionModule.IndexedElectionModel;
  IndexedVoteEventModel = indexedVoteEventModule.IndexedVoteEventModel;
  IndexedVoterRegistrationModel = indexedVoterRegistrationModule.IndexedVoterRegistrationModel;

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await AnalyticsRollupModel.deleteMany({});
  await IndexedElectionModel.deleteMany({});
  await IndexedVoteEventModel.deleteMany({});
  await IndexedVoterRegistrationModel.deleteMany({});
});

describe("Analytics module - GET /analytics/:id", () => {
  it("returns 404 for an unknown election", async () => {
    const res = await request(app).get("/analytics/999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });

  it("returns zeroed defaults when the election exists but no votes have been indexed yet", async () => {
    await IndexedElectionModel.create({ electionId: 1, title: "Empty Election", finalized: false, candidateIds: [0, 1] });

    const res = await request(app).get("/analytics/1");
    expect(res.status).toBe(200);
    expect(res.body.analytics).toEqual({
      onchainElectionId: 1,
      totalVotes: 0,
      turnoutPercent: 0,
      votesByCandidate: {},
      participationOverTime: [],
      lastUpdatedFromBlock: null,
    });
  });

  it("no auth required - this is public data, same convention as GET /elections/:id/results", async () => {
    await IndexedElectionModel.create({ electionId: 2, title: "Public Test", finalized: false, candidateIds: [0] });
    const res = await request(app).get("/analytics/2");
    expect(res.status).not.toBe(401);
  });
});

describe("Analytics module - recomputeRollup", () => {
  it("aggregates votes by candidate, computes turnout, and builds a cumulative participation series", async () => {
    await IndexedElectionModel.create({ electionId: 3, title: "Recompute Test", finalized: false, candidateIds: [0, 1] });
    await IndexedVoterRegistrationModel.create([
      { electionId: 3, voterAddress: "0xv1", registered: true, lastEventBlockNumber: 1n, lastEventLogIndex: 0 },
      { electionId: 3, voterAddress: "0xv2", registered: true, lastEventBlockNumber: 1n, lastEventLogIndex: 1 },
      { electionId: 3, voterAddress: "0xv3", registered: true, lastEventBlockNumber: 1n, lastEventLogIndex: 2 },
      { electionId: 3, voterAddress: "0xv4", registered: true, lastEventBlockNumber: 1n, lastEventLogIndex: 3 },
    ]);
    await IndexedVoteEventModel.create([
      {
        electionId: 3,
        voterAddress: "0xv1",
        candidateId: 0,
        txHash: "0x" + "a".repeat(64),
        logIndex: 0,
        blockNumber: 10n,
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        electionId: 3,
        voterAddress: "0xv2",
        candidateId: 0,
        txHash: "0x" + "b".repeat(64),
        logIndex: 0,
        blockNumber: 11n,
        timestamp: new Date("2026-01-01T00:01:00.000Z"),
      },
      {
        electionId: 3,
        voterAddress: "0xv3",
        candidateId: 1,
        txHash: "0x" + "c".repeat(64),
        logIndex: 0,
        blockNumber: 12n,
        timestamp: new Date("2026-01-01T00:02:00.000Z"),
      },
    ]);

    await recomputeRollup(3);

    const res = await request(app).get("/analytics/3");
    expect(res.status).toBe(200);
    expect(res.body.analytics.totalVotes).toBe(3);
    expect(res.body.analytics.turnoutPercent).toBeCloseTo(75); // 3 of 4 registered voters
    expect(res.body.analytics.votesByCandidate).toEqual({ "0": 2, "1": 1 });
    expect(res.body.analytics.participationOverTime).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", cumulativeVotes: 1 },
      { timestamp: "2026-01-01T00:01:00.000Z", cumulativeVotes: 2 },
      { timestamp: "2026-01-01T00:02:00.000Z", cumulativeVotes: 3 },
    ]);
    expect(res.body.analytics.lastUpdatedFromBlock).toBe("12");
  });

  it("is idempotent: recomputing twice with no new votes converges to the same result", async () => {
    await IndexedElectionModel.create({ electionId: 4, title: "Idempotency Test", finalized: false, candidateIds: [0] });
    await IndexedVoteEventModel.create({
      electionId: 4,
      voterAddress: "0xv1",
      candidateId: 0,
      txHash: "0x" + "d".repeat(64),
      logIndex: 0,
      blockNumber: 5n,
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
    });

    await recomputeRollup(4);
    await recomputeRollup(4);

    const count = await AnalyticsRollupModel.countDocuments({ onchainElectionId: 4 });
    expect(count).toBe(1); // upsert, not a duplicate document
    const rollup = await AnalyticsRollupModel.findOne({ onchainElectionId: 4 });
    expect(rollup?.totalVotes).toBe(1);
  });
});