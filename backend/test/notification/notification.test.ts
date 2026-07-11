// Tests for the Notifications module: POST /elections/:id/notifications/
// subscribe (real HTTP, real in-memory MongoDB, real SIWE sessions) and
// enqueueElectionFinalizedNotifications (a fake IJobQueue test double -
// same test-seam pattern as analytics.queue.ts/eventSync.test.ts's
// FakeJobQueue - no real Redis connection).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

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

class FakeJobQueue<T> {
  calls: { name: string; data: T; opts: { jobId?: string } }[] = [];
  async add(name: string, data: T, opts: { jobId?: string }): Promise<unknown> {
    this.calls.push({ name, data, opts });
    return { id: opts.jobId ?? "fake-job-id" };
  }
}

let mongod: MongoMemoryServer;
let app: Express;
let SESSION_COOKIE_NAME: string;
let IndexedElectionModel: typeof import("../../src/modules/indexing/indexedElection.model.js").IndexedElectionModel;
let NotificationPreferenceModel: typeof import("../../src/modules/notifications/notificationPreference.model.js").NotificationPreferenceModel;
let enqueueElectionFinalizedNotifications: typeof import("../../src/modules/notifications/notification.service.js").enqueueElectionFinalizedNotifications;
let fakeQueue: FakeJobQueue<{ to: string; subject: string; html: string }>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");
  const indexedElectionModule = await import("../../src/modules/indexing/indexedElection.model.js");
  const notificationPreferenceModule = await import("../../src/modules/notifications/notificationPreference.model.js");
  const notificationServiceModule = await import("../../src/modules/notifications/notification.service.js");
  const notificationQueueModule = await import("../../src/modules/notifications/notification.queue.js");

  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;
  IndexedElectionModel = indexedElectionModule.IndexedElectionModel;
  NotificationPreferenceModel = notificationPreferenceModule.NotificationPreferenceModel;
  enqueueElectionFinalizedNotifications = notificationServiceModule.enqueueElectionFinalizedNotifications;

  fakeQueue = new FakeJobQueue();
  notificationQueueModule._setNotificationDispatchQueueForTests(fakeQueue);

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await IndexedElectionModel.deleteMany({});
  await NotificationPreferenceModel.deleteMany({});
  fakeQueue.calls = [];
});

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
  return { cookie, address: account.address.toLowerCase() };
}

describe("Notifications module - POST /elections/:id/notifications/subscribe", () => {
  it("returns 401 with no session", async () => {
    const res = await request(app).post("/elections/1/notifications/subscribe").send({ email: "voter@example.com" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown election", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/999/notifications/subscribe")
      .set("Cookie", cookie)
      .send({ email: "voter@example.com" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });

  it("returns 400 for an invalid email", async () => {
    await IndexedElectionModel.create({ electionId: 1, title: "Test Election", finalized: false, candidateIds: [] });
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/1/notifications/subscribe")
      .set("Cookie", cookie)
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("subscribes using the session's own wallet address, ignoring any client-supplied address", async () => {
    await IndexedElectionModel.create({ electionId: 1, title: "Test Election", finalized: false, candidateIds: [] });
    const { cookie, address } = await getAuthenticatedCookie();

    const res = await request(app)
      .post("/elections/1/notifications/subscribe")
      .set("Cookie", cookie)
      .send({ email: "voter@example.com", walletAddress: "0xattacker-supplied-address" });
    expect(res.status).toBe(204);

    const preference = await NotificationPreferenceModel.findOne({ electionId: 1 });
    expect(preference?.walletAddress).toBe(address);
    expect(preference?.email).toBe("voter@example.com");
  });

  it("upserts on repeated subscription (updating the email, not creating a duplicate)", async () => {
    await IndexedElectionModel.create({ electionId: 1, title: "Test Election", finalized: false, candidateIds: [] });
    const { cookie, address } = await getAuthenticatedCookie();

    await request(app).post("/elections/1/notifications/subscribe").set("Cookie", cookie).send({ email: "old@example.com" });
    await request(app).post("/elections/1/notifications/subscribe").set("Cookie", cookie).send({ email: "new@example.com" });

    const count = await NotificationPreferenceModel.countDocuments({ electionId: 1, walletAddress: address });
    expect(count).toBe(1);
    const preference = await NotificationPreferenceModel.findOne({ electionId: 1, walletAddress: address });
    expect(preference?.email).toBe("new@example.com");
  });
});

describe("Notifications module - enqueueElectionFinalizedNotifications", () => {
  it("enqueues one job per subscriber with a stable, dedup-friendly jobId", async () => {
    await NotificationPreferenceModel.create([
      { electionId: 2, walletAddress: "0xaaa", email: "a@example.com" },
      { electionId: 2, walletAddress: "0xbbb", email: "b@example.com" },
    ]);

    await enqueueElectionFinalizedNotifications(2, "Test Election");

    expect(fakeQueue.calls).toHaveLength(2);
    const jobIds = fakeQueue.calls.map((c) => c.opts.jobId).sort();
    expect(jobIds).toEqual(["notify:2:0xaaa", "notify:2:0xbbb"]);
    expect(fakeQueue.calls[0]?.data.subject).toContain("Test Election");
  });

  it("does nothing when nobody is subscribed", async () => {
    await enqueueElectionFinalizedNotifications(3, "Unsubscribed Election");
    expect(fakeQueue.calls).toHaveLength(0);
  });
});