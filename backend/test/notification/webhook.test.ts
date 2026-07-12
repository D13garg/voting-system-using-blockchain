// Tests for the webhook half of the Notifications module (gap #4):
// POST /elections/:id/notifications/webhook-subscribe (real HTTP, real
// in-memory MongoDB, real SIWE sessions) and
// enqueueElectionFinalizedWebhooks (a fake IJobQueue test double - same
// test-seam pattern as notification.test.ts's FakeJobQueue, no real
// Redis connection). Deliberately its own file/model/queue, not folded
// into notification.test.ts, mirroring the source split (webhook.queue.ts
// vs notification.queue.ts).

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
let WebhookPreferenceModel: typeof import("../../src/modules/notifications/webhookPreference.model.js").WebhookPreferenceModel;
let enqueueElectionFinalizedWebhooks: typeof import("../../src/modules/notifications/notification.service.js").enqueueElectionFinalizedWebhooks;
let fakeQueue: FakeJobQueue<{ url: string; secret: string; payload: Record<string, unknown> }>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");
  const indexedElectionModule = await import("../../src/modules/indexing/indexedElection.model.js");
  const webhookPreferenceModule = await import("../../src/modules/notifications/webhookPreference.model.js");
  const notificationServiceModule = await import("../../src/modules/notifications/notification.service.js");
  const webhookQueueModule = await import("../../src/modules/notifications/webhook.queue.js");

  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;
  IndexedElectionModel = indexedElectionModule.IndexedElectionModel;
  WebhookPreferenceModel = webhookPreferenceModule.WebhookPreferenceModel;
  enqueueElectionFinalizedWebhooks = notificationServiceModule.enqueueElectionFinalizedWebhooks;

  fakeQueue = new FakeJobQueue();
  webhookQueueModule._setWebhookDispatchQueueForTests(fakeQueue);

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await IndexedElectionModel.deleteMany({});
  await WebhookPreferenceModel.deleteMany({});
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

describe("Notifications module - POST /elections/:id/notifications/webhook-subscribe", () => {
  it("returns 401 with no session", async () => {
    const res = await request(app)
      .post("/elections/1/notifications/webhook-subscribe")
      .send({ url: "https://example.com/hooks/voting" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown election", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/999/notifications/webhook-subscribe")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/hooks/voting" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ELECTION_NOT_FOUND");
  });

  it("returns 400 for an invalid URL", async () => {
    await IndexedElectionModel.create({ electionId: 1, title: "Test Election", finalized: false, candidateIds: [] });
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/elections/1/notifications/webhook-subscribe")
      .set("Cookie", cookie)
      .send({ url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("subscribes using the session's own wallet address and returns a secret", async () => {
    await IndexedElectionModel.create({ electionId: 1, title: "Test Election", finalized: false, candidateIds: [] });
    const { cookie, address } = await getAuthenticatedCookie();

    const res = await request(app)
      .post("/elections/1/notifications/webhook-subscribe")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/hooks/voting", walletAddress: "0xattacker-supplied-address" });
    expect(res.status).toBe(200);
    expect(typeof res.body.secret).toBe("string");
    expect((res.body.secret as string).length).toBeGreaterThanOrEqual(32);

    const preference = await WebhookPreferenceModel.findOne({ electionId: 1 });
    expect(preference?.walletAddress).toBe(address);
    expect(preference?.url).toBe("https://example.com/hooks/voting");
    expect(preference?.secret).toBe(res.body.secret);
  });

  it("upserts on repeated subscription (updating the URL, rotating the secret, not creating a duplicate)", async () => {
    await IndexedElectionModel.create({ electionId: 1, title: "Test Election", finalized: false, candidateIds: [] });
    const { cookie, address } = await getAuthenticatedCookie();

    const first = await request(app)
      .post("/elections/1/notifications/webhook-subscribe")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/old-hook" });
    const second = await request(app)
      .post("/elections/1/notifications/webhook-subscribe")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/new-hook" });

    expect(first.body.secret).not.toBe(second.body.secret);

    const count = await WebhookPreferenceModel.countDocuments({ electionId: 1, walletAddress: address });
    expect(count).toBe(1);
    const preference = await WebhookPreferenceModel.findOne({ electionId: 1, walletAddress: address });
    expect(preference?.url).toBe("https://example.com/new-hook");
    expect(preference?.secret).toBe(second.body.secret);
  });
});

describe("Notifications module - enqueueElectionFinalizedWebhooks", () => {
  it("enqueues one job per subscriber with a stable, dedup-friendly jobId", async () => {
    await WebhookPreferenceModel.create([
      { electionId: 2, walletAddress: "0xaaa", url: "https://a.example.com/hook", secret: "secret-a" },
      { electionId: 2, walletAddress: "0xbbb", url: "https://b.example.com/hook", secret: "secret-b" },
    ]);

    await enqueueElectionFinalizedWebhooks(2, "Test Election");

    expect(fakeQueue.calls).toHaveLength(2);
    const jobIds = fakeQueue.calls.map((c) => c.opts.jobId).sort();
    expect(jobIds).toEqual(["webhook:2:0xaaa", "webhook:2:0xbbb"]);
    expect(fakeQueue.calls[0]?.data.payload).toMatchObject({ event: "election.finalized", electionId: 2, title: "Test Election" });
  });

  it("carries each subscriber's own url/secret through to the enqueued job, not a shared one", async () => {
    await WebhookPreferenceModel.create([
      { electionId: 2, walletAddress: "0xaaa", url: "https://a.example.com/hook", secret: "secret-a" },
      { electionId: 2, walletAddress: "0xbbb", url: "https://b.example.com/hook", secret: "secret-b" },
    ]);

    await enqueueElectionFinalizedWebhooks(2, "Test Election");

    const byWallet = new Map(fakeQueue.calls.map((c) => [c.opts.jobId, c.data]));
    expect(byWallet.get("webhook:2:0xaaa")).toMatchObject({ url: "https://a.example.com/hook", secret: "secret-a" });
    expect(byWallet.get("webhook:2:0xbbb")).toMatchObject({ url: "https://b.example.com/hook", secret: "secret-b" });
  });

  it("does nothing when nobody is subscribed", async () => {
    await enqueueElectionFinalizedWebhooks(3, "Unsubscribed Election");
    expect(fakeQueue.calls).toHaveLength(0);
  });

  it("includes the finalizer's display name in the payload when finalizedBy is provided, null otherwise (item 2 - Wallet module wiring)", async () => {
    const finalizer = "0x2222222222222222222222222222222222222222";
    await WebhookPreferenceModel.create([{ electionId: 4, walletAddress: "0xeee", url: "https://e.example.com/hook", secret: "secret-e" }]);

    await enqueueElectionFinalizedWebhooks(4, "Finalized By Test", finalizer);
    // No RPC_URL_MAINNET_ENS in REQUIRED_ENV, so this degrades to the
    // checksummed address rather than an ENS name.
    expect(fakeQueue.calls[0]?.data.payload).toMatchObject({ finalizedBy: finalizer });

    await WebhookPreferenceModel.create([{ electionId: 6, walletAddress: "0xfff", url: "https://f.example.com/hook", secret: "secret-f" }]);
    await enqueueElectionFinalizedWebhooks(6, "No Finalizer Test");
    expect(fakeQueue.calls[1]?.data.payload).toMatchObject({ finalizedBy: null });
  });
});