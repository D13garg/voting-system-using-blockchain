// Tests for the Auth module (Phase 5's first domain module).
//
// Uses a REAL in-memory MongoDB (mongodb-memory-server) and REAL
// viem-signed SIWE messages (privateKeyToAccount + signMessage) verified
// against the real `siwe` library - not mocks. Cross-library
// compatibility (viem-produced signature, siwe-consumed) was confirmed
// separately in a standalone no-DB repro; see HANDOFF.md's Phase 5
// section.
//
// NOTE: mongodb-memory-server needs to download a real mongod binary from
// fastdl.mongodb.org on first run. That host is not reachable in every
// sandboxed environment (same category of restriction as
// binaries.soliditylang.org for the contracts package - see
// HANDOFF.md's verification-discipline notes). If this suite fails with a
// download/403 error rather than a real test failure, that is this
// environment's network restriction, not a bug in this suite - it should
// run cleanly wherever fastdl.mongodb.org is reachable.
//
// Env vars are set on process.env in beforeAll, BEFORE any dynamic import
// of src/config/env.ts or anything that transitively imports it - same
// reasoning and pattern as test/env.test.ts and
// test/integration/harness.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const REQUIRED_NON_AUTH_ENV = {
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
  FRONTEND_ORIGIN: "http://localhost:5173",
};

const SIWE_DOMAIN = "localhost:5173";

let mongod: MongoMemoryServer;
let app: Express;
let issueNonce: typeof import("../../src/modules/auth/auth.service.js").issueNonce;
let verifySiweAndCreateSession: typeof import("../../src/modules/auth/auth.service.js").verifySiweAndCreateSession;
let resolveSession: typeof import("../../src/modules/auth/auth.service.js").resolveSession;
let revokeSession: typeof import("../../src/modules/auth/auth.service.js").revokeSession;
let SessionModel: typeof import("../../src/modules/auth/auth.session.model.js").SessionModel;
let NonceModel: typeof import("../../src/modules/auth/auth.nonce.model.js").NonceModel;
let SESSION_COOKIE_NAME: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  Object.assign(process.env, REQUIRED_NON_AUTH_ENV, {
    MONGODB_URI: mongod.getUri(),
    SIWE_DOMAIN,
    SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
    SIWE_SESSION_TTL_SECONDS: "86400",
  });

  // Fresh imports, cache-busted, so this module graph (and env.ts's
  // singleton within it) loads against the env vars just set above - same
  // pattern as test/env.test.ts and test/integration/blockchain.integration.test.ts.
  const authService = await import("../../src/modules/auth/auth.service.js");
  const authSessionModel = await import("../../src/modules/auth/auth.session.model.js");
  const authNonceModel = await import("../../src/modules/auth/auth.nonce.model.js");
  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

  issueNonce = authService.issueNonce;
  verifySiweAndCreateSession = authService.verifySiweAndCreateSession;
  resolveSession = authService.resolveSession;
  revokeSession = authService.revokeSession;
  SessionModel = authSessionModel.SessionModel;
  NonceModel = authNonceModel.NonceModel;
  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  // Guards against beforeAll having failed before mongod was assigned
  // (e.g. the binary download failing in a sandboxed environment - see
  // this file's header comment) - without this guard, that failure was
  // masked by a confusing secondary "Cannot read properties of undefined"
  // here instead of surfacing the real error clearly.
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await NonceModel.deleteMany({});
  await SessionModel.deleteMany({});
});

/** Builds and signs a real SIWE message for a fresh random account. */
async function createSignedSiweMessage(nonce: string): Promise<{ message: string; signature: string; address: string }> {
  const account = privateKeyToAccount(generatePrivateKey());
  const siweMessage = new SiweMessage({
    domain: SIWE_DOMAIN,
    address: account.address,
    statement: "Sign in to Decentralized Voting System",
    uri: `http://${SIWE_DOMAIN}`,
    version: "1",
    chainId: 31337,
    nonce,
  });
  const message = siweMessage.prepareMessage();
  const signature = await account.signMessage({ message });
  return { message, signature, address: account.address };
}

describe("Auth module - service layer", () => {
  describe("issueNonce", () => {
    it("creates a persisted, single-use nonce with a future expiry", async () => {
      const { nonce, expiresAt } = await issueNonce();
      expect(nonce.length).toBeGreaterThanOrEqual(8);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

      const stored = await NonceModel.findOne({ nonce });
      expect(stored).not.toBeNull();
    });
  });

  describe("verifySiweAndCreateSession", () => {
    it("verifies a real signed SIWE message and issues a session", async () => {
      const { nonce } = await issueNonce();
      const { message, signature, address } = await createSignedSiweMessage(nonce);

      const result = await verifySiweAndCreateSession({ message, signature });

      expect(result.address).toBe(address);
      expect(result.rawToken).toBeTruthy();
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const sessionCount = await SessionModel.countDocuments({ address });
      expect(sessionCount).toBe(1);
    });

    it("rejects reusing the same nonce a second time (single-use)", async () => {
      const { nonce } = await issueNonce();
      const { message, signature } = await createSignedSiweMessage(nonce);

      await verifySiweAndCreateSession({ message, signature });

      await expect(verifySiweAndCreateSession({ message, signature })).rejects.toMatchObject({
        status: 401,
        code: "INVALID_OR_EXPIRED_NONCE",
      });
    });

    it("rejects a nonce that was never issued", async () => {
      const { message, signature } = await createSignedSiweMessage("neverissuednonce123");

      await expect(verifySiweAndCreateSession({ message, signature })).rejects.toMatchObject({
        status: 401,
        code: "INVALID_OR_EXPIRED_NONCE",
      });
    });

    it("rejects a message whose signature doesn't match its claimed address", async () => {
      const { nonce } = await issueNonce();
      const { message } = await createSignedSiweMessage(nonce);
      // Sign with a DIFFERENT account than the one named in the message -
      // exercises real signature-recovery failure, not just a malformed
      // input.
      const wrongAccount = privateKeyToAccount(generatePrivateKey());
      const wrongSignature = await wrongAccount.signMessage({ message });

      await expect(verifySiweAndCreateSession({ message, signature: wrongSignature })).rejects.toMatchObject({
        status: 401,
        code: "SIWE_VERIFICATION_FAILED",
      });
    });

    it("rejects an unparseable message", async () => {
      await expect(
        verifySiweAndCreateSession({ message: "not a siwe message", signature: "0xdead" }),
      ).rejects.toMatchObject({
        status: 422,
        code: "INVALID_SIWE_MESSAGE",
      });
    });
  });

  describe("resolveSession", () => {
    it("resolves a valid session token to its address", async () => {
      const { nonce } = await issueNonce();
      const { message, signature, address } = await createSignedSiweMessage(nonce);
      const { rawToken } = await verifySiweAndCreateSession({ message, signature });

      const resolved = await resolveSession(rawToken);
      expect(resolved).toMatchObject({ address });
    });

    it("returns null for a garbage token", async () => {
      await expect(resolveSession("not-a-real-token")).resolves.toBeNull();
    });

    it("returns null for undefined (no cookie present)", async () => {
      await expect(resolveSession(undefined)).resolves.toBeNull();
    });

    it("returns null for an expired session, even though the DB row may not yet be TTL-swept", async () => {
      const { nonce } = await issueNonce();
      const { message, signature } = await createSignedSiweMessage(nonce);
      const { rawToken } = await verifySiweAndCreateSession({ message, signature });

      // Directly backdate the session's expiry rather than waiting for a
      // real TTL to elapse - deterministic and fast, and exercises
      // exactly the "expiresAt > now" query condition in
      // auth.service.ts's resolveSession, independent of whether Mongo's
      // background TTL monitor has run yet.
      await SessionModel.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      await expect(resolveSession(rawToken)).resolves.toBeNull();
    });
  });

  describe("revokeSession", () => {
    it("deletes the session so it no longer resolves", async () => {
      const { nonce } = await issueNonce();
      const { message, signature } = await createSignedSiweMessage(nonce);
      const { rawToken } = await verifySiweAndCreateSession({ message, signature });

      await revokeSession(rawToken);

      await expect(resolveSession(rawToken)).resolves.toBeNull();
    });

    it("is a no-op (does not throw) for a token that doesn't exist", async () => {
      await expect(revokeSession("nonexistent-token")).resolves.toBeUndefined();
    });
  });
});

describe("Auth module - HTTP routes", () => {
  it("POST /auth/nonce returns a fresh nonce", async () => {
    const response = await request(app).post("/auth/nonce").send();
    expect(response.status).toBe(200);
    expect(typeof response.body.nonce).toBe("string");
    expect(response.body.nonce.length).toBeGreaterThanOrEqual(8);
  });

  it("full flow: nonce -> siwe -> session -> logout, via real HTTP requests", async () => {
    const nonceResponse = await request(app).post("/auth/nonce").send();
    const nonce: string = nonceResponse.body.nonce;
    const { message, signature, address } = await createSignedSiweMessage(nonce);

    const siweResponse = await request(app).post("/auth/siwe").send({ message, signature });
    expect(siweResponse.status).toBe(200);
    expect(siweResponse.body).toEqual({ address });
    const setCookieHeader = siweResponse.headers["set-cookie"];
    expect(setCookieHeader).toBeDefined();
    const sessionCookie = (setCookieHeader as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toBeDefined();

    const sessionResponse = await request(app).get("/auth/session").set("Cookie", sessionCookie!);
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body).toEqual({ address });

    const logoutResponse = await request(app).post("/auth/logout").set("Cookie", sessionCookie!);
    expect(logoutResponse.status).toBe(204);

    const afterLogoutResponse = await request(app).get("/auth/session").set("Cookie", sessionCookie!);
    expect(afterLogoutResponse.status).toBe(401);
  });

  it("GET /auth/session without a cookie returns 401", async () => {
    const response = await request(app).get("/auth/session");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("POST /auth/logout without a cookie is idempotent (204, not an error)", async () => {
    const response = await request(app).post("/auth/logout");
    expect(response.status).toBe(204);
  });

  it("POST /auth/siwe with a malformed body returns 400 from zod validation, not 500", async () => {
    const response = await request(app).post("/auth/siwe").send({ message: "" });
    expect(response.status).toBe(400);
  });
});