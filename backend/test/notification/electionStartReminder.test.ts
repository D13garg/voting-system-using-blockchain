// Tests for gap #7 (election-start reminder):
//   - POST /elections/:id/notifications/start-reminder-subscribe (real
//     HTTP, real in-memory MongoDB, real SIWE sessions)
//   - runElectionStartScan (the scan tick itself - real Mongo via
//     mongodb-memory-server, a fake IJobQueue test double for the actual
//     email/webhook dispatch, same pattern as notification.test.ts/
//     webhook.test.ts - no real Redis/BullMQ Worker involved)
//
// Deliberately its own file rather than folded into notification.test.ts
// or webhook.test.ts - this exercises a THIRD model field
// (wantsStartReminders, on both existing preference models) and a
// wholly different trigger shape (wall-clock scan vs. HTTP request vs.
// on-chain event), matching the source-level separation
// (electionStartScan.worker.ts is its own file).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  ELECTION_START_REMINDER_LEAD_TIME_MS: String(60 * 60 * 1000), // 1 hour, matches the documented default
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
let WebhookPreferenceModel: typeof import("../../src/modules/notifications/webhookPreference.model.js").WebhookPreferenceModel;
let runElectionStartScan: typeof import("../../src/modules/notifications/electionStartScan.worker.js").runElectionStartScan;
let emailQueue: FakeJobQueue<{ to: string; subject: string; html: string }>;
let webhookQueue: FakeJobQueue<{ url: string; secret: string; payload: Record<string, unknown> }>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");
  const indexedElectionModule = await import("../../src/modules/indexing/indexedElection.model.js");
  const notificationPreferenceModule = await import("../../src/modules/notifications/notificationPreference.model.js");
  const webhookPreferenceModule = await import("../../src/modules/notifications/webhookPreference.model.js");
  const notificationQueueModule = await import("../../src/modules/notifications/notification.queue.js");
  const webhookQueueModule = await import("../../src/modules/notifications/webhook.queue.js");
  const electionStartScanModule = await import("../../src/modules/notifications/electionStartScan.worker.js");

  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;
  IndexedElectionModel = indexedElectionModule.IndexedElectionModel;
  NotificationPreferenceModel = notificationPreferenceModule.NotificationPreferenceModel;
  WebhookPreferenceModel = webhookPreferenceModule.WebhookPreferenceModel;
  runElectionStartScan = electionStartScanModule.runElectionStartScan;

  emailQueue = new FakeJobQueue();
  webhookQueue = new FakeJobQueue();
  notificationQueueModule._setNotificationDispatchQueueForTests(emailQueue);
  webhookQueueModule._setWebhookDispatchQueueForTests(webhookQueue);

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
  await WebhookPreferenceModel.deleteMany({});
  emailQueue.calls = [];
  webhookQueue.calls = [];
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

describe("Notifications module - POST /elections/:id/notifications/start-reminder-subscribe", () => {
  it("returns 401 with no session", async () => {
    const res = await request(app).post("/elections/1/notifications/start-reminder-subscribe").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 when the caller has no email or webhook subscription for this election", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/1/notifications/start-reminder-subscribe")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_SUBSCRIBED");
  });

  it("flips wantsStartReminders on an existing email subscription", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    await NotificationPreferenceModel.create({ electionId: 1, walletAddress: address, email: "voter@example.com" });

    const res = await request(app)
      .post("/elections/1/notifications/start-reminder-subscribe")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(204);

    const preference = await NotificationPreferenceModel.findOne({ electionId: 1, walletAddress: address });
    expect(preference?.wantsStartReminders).toBe(true);
  });

  it("flips wantsStartReminders on an existing webhook subscription without rotating its secret", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    await WebhookPreferenceModel.create({
      electionId: 1,
      walletAddress: address,
      url: "https://example.com/hook",
      secret: "original-secret",
    });

    const res = await request(app)
      .post("/elections/1/notifications/start-reminder-subscribe")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(204);

    const preference = await WebhookPreferenceModel.findOne({ electionId: 1, walletAddress: address });
    expect(preference?.wantsStartReminders).toBe(true);
    expect(preference?.secret).toBe("original-secret");
  });

  it("flips the flag on both channels when the caller is subscribed to both", async () => {
    const { cookie, address } = await getAuthenticatedCookie();
    await NotificationPreferenceModel.create({ electionId: 1, walletAddress: address, email: "voter@example.com" });
    await WebhookPreferenceModel.create({
      electionId: 1,
      walletAddress: address,
      url: "https://example.com/hook",
      secret: "s",
    });

    const res = await request(app)
      .post("/elections/1/notifications/start-reminder-subscribe")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(204);

    const emailPref = await NotificationPreferenceModel.findOne({ electionId: 1, walletAddress: address });
    const webhookPref = await WebhookPreferenceModel.findOne({ electionId: 1, walletAddress: address });
    expect(emailPref?.wantsStartReminders).toBe(true);
    expect(webhookPref?.wantsStartReminders).toBe(true);
  });
});

describe("Notifications module - runElectionStartScan", () => {
  const HOUR = 60 * 60;

  it("sends a starting-soon reminder to opted-in subscribers within the lead window", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));

    await IndexedElectionModel.create({
      electionId: 1,
      title: "Board Election",
      startTime: nowSeconds + BigInt(30 * 60), // 30 minutes from now - inside the 1h lead window
      endTime: nowSeconds + BigInt(2 * HOUR),
      finalized: false,
      candidateIds: [],
    });
    await NotificationPreferenceModel.create({
      electionId: 1,
      walletAddress: "0xaaa",
      email: "a@example.com",
      wantsStartReminders: true,
    });
    await WebhookPreferenceModel.create({
      electionId: 1,
      walletAddress: "0xbbb",
      url: "https://example.com/hook",
      secret: "s",
      wantsStartReminders: true,
    });

    await runElectionStartScan(now);

    expect(emailQueue.calls).toHaveLength(1);
    expect(emailQueue.calls[0]?.opts.jobId).toBe("start-reminder:1:0xaaa");
    expect(webhookQueue.calls).toHaveLength(1);
    expect(webhookQueue.calls[0]?.opts.jobId).toBe("start-reminder-webhook:1:0xbbb");
    expect(webhookQueue.calls[0]?.data.payload).toMatchObject({ event: "election.starting_soon", electionId: 1 });

    const mirror = await IndexedElectionModel.findOne({ electionId: 1 });
    expect(mirror?.startReminderSentAt).toBeInstanceOf(Date);
  });

  it("does not remind subscribers who never opted in", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));

    await IndexedElectionModel.create({
      electionId: 2,
      title: "Opt-out Election",
      startTime: nowSeconds + BigInt(30 * 60),
      endTime: nowSeconds + BigInt(2 * HOUR),
      finalized: false,
      candidateIds: [],
    });
    await NotificationPreferenceModel.create({
      electionId: 2,
      walletAddress: "0xccc",
      email: "c@example.com",
      // wantsStartReminders defaults to false - never opted in.
    });

    await runElectionStartScan(now);

    expect(emailQueue.calls).toHaveLength(0);
  });

  it("does not remind twice for the same election across two scan ticks", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));

    await IndexedElectionModel.create({
      electionId: 3,
      title: "Repeat-Tick Election",
      startTime: nowSeconds + BigInt(30 * 60),
      endTime: nowSeconds + BigInt(2 * HOUR),
      finalized: false,
      candidateIds: [],
    });
    await NotificationPreferenceModel.create({
      electionId: 3,
      walletAddress: "0xddd",
      email: "d@example.com",
      wantsStartReminders: true,
    });

    await runElectionStartScan(now);
    await runElectionStartScan(new Date(now.getTime() + 5 * 60 * 1000)); // 5 minutes later, still inside the window

    expect(emailQueue.calls).toHaveLength(1);
  });

  it("ignores elections whose start is outside the lead window", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));

    await IndexedElectionModel.create({
      electionId: 4,
      title: "Far-Future Election",
      startTime: nowSeconds + BigInt(10 * HOUR), // well outside the 1h lead window
      endTime: nowSeconds + BigInt(11 * HOUR),
      finalized: false,
      candidateIds: [],
    });
    await NotificationPreferenceModel.create({
      electionId: 4,
      walletAddress: "0xeee",
      email: "e@example.com",
      wantsStartReminders: true,
    });

    await runElectionStartScan(now);

    expect(emailQueue.calls).toHaveLength(0);
  });

  it("sends a voting-open notice once startTime has passed but before endTime", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));

    await IndexedElectionModel.create({
      electionId: 5,
      title: "Now Open Election",
      startTime: nowSeconds - BigInt(10 * 60), // started 10 minutes ago
      endTime: nowSeconds + BigInt(HOUR),
      finalized: false,
      candidateIds: [],
    });
    await NotificationPreferenceModel.create({
      electionId: 5,
      walletAddress: "0xfff",
      email: "f@example.com",
      wantsStartReminders: true,
    });

    await runElectionStartScan(now);

    expect(emailQueue.calls).toHaveLength(1);
    expect(emailQueue.calls[0]?.opts.jobId).toBe("voting-open:5:0xfff");

    const mirror = await IndexedElectionModel.findOne({ electionId: 5 });
    expect(mirror?.votingOpenNotifiedAt).toBeInstanceOf(Date);
  });

  it("does not send a voting-open notice for an election that has already ended", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));

    await IndexedElectionModel.create({
      electionId: 6,
      title: "Already-Ended Election",
      startTime: nowSeconds - BigInt(2 * HOUR),
      endTime: nowSeconds - BigInt(HOUR), // ended an hour ago
      finalized: false,
      candidateIds: [],
    });
    await NotificationPreferenceModel.create({
      electionId: 6,
      walletAddress: "0x111",
      email: "g@example.com",
      wantsStartReminders: true,
    });

    await runElectionStartScan(now);

    expect(emailQueue.calls).toHaveLength(0);
  });

  it("does nothing when there are no elections at all", async () => {
    await runElectionStartScan(new Date());
    expect(emailQueue.calls).toHaveLength(0);
    expect(webhookQueue.calls).toHaveLength(0);
  });
});