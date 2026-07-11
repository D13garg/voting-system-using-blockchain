// Tests for the Audit module (architecture Section 17): recordAuditLog
// exercised directly (both the on-chain idempotent-upsert path and the
// off-chain plain-insert path - see audit.model.ts's header comment for
// why they differ), and GET /admin/audit-logs over real HTTP with a real
// SIWE session. No queue/Redis involved at all, same as analytics.test.ts.

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

let mongod: MongoMemoryServer;
let app: Express;
let SESSION_COOKIE_NAME: string;
let recordAuditLog: typeof import("../../src/modules/audit/audit.service.js").recordAuditLog;
let AuditLogModel: typeof import("../../src/modules/audit/audit.model.js").AuditLogModel;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");
  const auditServiceModule = await import("../../src/modules/audit/audit.service.js");
  const auditModelModule = await import("../../src/modules/audit/audit.model.js");

  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;
  recordAuditLog = auditServiceModule.recordAuditLog;
  AuditLogModel = auditModelModule.AuditLogModel;

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await AuditLogModel.deleteMany({});
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

describe("recordAuditLog", () => {
  it("on-chain path: upserts idempotently on {txHash, logIndex} - a redelivered log does not duplicate", async () => {
    const entry = {
      category: "ROLE_GRANTED" as const,
      source: "on-chain" as const,
      actor: "0xsysadmin",
      subject: "0xnewadmin",
      role: "ELECTION_ADMINISTRATOR_ROLE",
      txHash: "0x" + "a".repeat(64),
      logIndex: 0,
      blockNumber: 10n,
      occurredAt: new Date("2026-01-01T00:00:00Z"),
    };

    await recordAuditLog(entry);
    await recordAuditLog(entry); // simulated redelivery

    const docs = await AuditLogModel.find({});
    expect(docs).toHaveLength(1);
  });

  it("off-chain path: plain insert, no txHash/logIndex set on the document at all (required for the sparse index to work)", async () => {
    await recordAuditLog({
      category: "REGISTRATION_APPROVED",
      source: "off-chain",
      actor: "0xadmin",
      subject: "0xvoter1",
      electionId: 1,
      metadata: { requestId: "abc123" },
      occurredAt: new Date("2026-01-01T00:00:00Z"),
    });

    const docs = await AuditLogModel.find({}).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]).not.toHaveProperty("txHash");
    expect(docs[0]).not.toHaveProperty("logIndex");
  });

  it("two different off-chain entries with no txHash never collide, even though both omit the field (sparse unique index)", async () => {
    await recordAuditLog({
      category: "REGISTRATION_APPROVED",
      source: "off-chain",
      actor: "0xadmin",
      subject: "0xvoter1",
      electionId: 1,
      occurredAt: new Date(),
    });
    await recordAuditLog({
      category: "REGISTRATION_REJECTED",
      source: "off-chain",
      actor: "0xadmin",
      subject: "0xvoter2",
      electionId: 1,
      occurredAt: new Date(),
    });

    const docs = await AuditLogModel.find({});
    expect(docs).toHaveLength(2);
  });
});

describe("GET /admin/audit-logs", () => {
  beforeEach(async () => {
    await recordAuditLog({
      category: "ELECTION_CREATED",
      source: "on-chain",
      actor: "0xcreator",
      electionId: 1,
      contractName: "Election",
      txHash: "0x" + "1".repeat(64),
      logIndex: 0,
      blockNumber: 10n,
      occurredAt: new Date("2026-01-01T00:00:00Z"),
    });
    await recordAuditLog({
      category: "ROLE_GRANTED",
      source: "on-chain",
      actor: "0xsysadmin",
      subject: "0xnewadmin",
      role: "ELECTION_ADMINISTRATOR_ROLE",
      contractName: "Election",
      txHash: "0x" + "2".repeat(64),
      logIndex: 0,
      blockNumber: 11n,
      occurredAt: new Date("2026-01-02T00:00:00Z"),
    });
  });

  it("returns 401 with no session", async () => {
    const res = await request(app).get("/admin/audit-logs");
    expect(res.status).toBe(401);
  });

  it("returns entries newest-first with an authenticated session", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/admin/audit-logs").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0].category).toBe("ROLE_GRANTED"); // 2026-01-02, newer
    expect(res.body.entries[1].category).toBe("ELECTION_CREATED");
    expect(res.body.total).toBe(2);
  });

  it("filters by category", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/admin/audit-logs?category=ROLE_GRANTED").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].category).toBe("ROLE_GRANTED");
  });

  it("filters by electionId", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/admin/audit-logs?electionId=1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].category).toBe("ELECTION_CREATED");
  });

  it("paginates with page/limit", async () => {
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/admin/audit-logs?limit=1&page=2").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].category).toBe("ELECTION_CREATED"); // page 2 of a newest-first, limit-1 list
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(1);
  });
});