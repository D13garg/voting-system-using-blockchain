// Tests for the rate limiting middleware (gap #3).
//
// Deliberately a tiny standalone Express app, not the full buildApp() -
// this is unit-testing the middleware's own behavior (method filtering,
// 429 shape, fail-open, tier independence), not integrating with every
// domain module. No real Redis connection is ever made: NODE_ENV=test
// makes both limiters default to a no-op (see rateLimiter.ts's header
// comment for why that default exists), and every test below that wants
// to exercise real enforcement/failure behavior injects a FakeRateLimiter
// via the _set*ForTests seams - same DI pattern as this codebase's other
// fakes (IElectionContractClient, IEnsClient, IJobQueue).

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const REQUIRED_ENV = {
  NODE_ENV: "test",
  RPC_URL_PRIMARY: "http://127.0.0.1:8545",
  RPC_URL_FALLBACK: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  CONTRACT_ADDRESS_ELECTION: "0x0000000000000000000000000000000000000001",
  CONTRACT_ADDRESS_VOTER_REGISTRY: "0x0000000000000000000000000000000000000002",
  MONGODB_URI: "mongodb://localhost:27017/unused-by-these-tests",
  REDIS_URL: "redis://localhost:6379",
  IPFS_API_KEY: "test-ipfs-key",
  IPFS_API_SECRET: "test-ipfs-secret",
  RESEND_API_KEY: "test-resend-key",
  SIWE_DOMAIN: "localhost:5173",
  SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
  FRONTEND_ORIGIN: "http://localhost:5173",
};

let rateLimiterModule: typeof import("../../src/middleware/rateLimiter.js");
let errorHandlerModule: typeof import("../../src/middleware/errorHandler.js");

class FakeRateLimiter {
  calls: string[] = [];
  mode: "allow" | "exceeded" | "infra-error" = "allow";

  async consume(key: string): Promise<void> {
    this.calls.push(key);
    if (this.mode === "exceeded") {
      throw new rateLimiterModule.RateLimitExceededError(5000);
    }
    if (this.mode === "infra-error") {
      throw new Error("simulated Redis outage");
    }
  }
}

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  rateLimiterModule = await import("../../src/middleware/rateLimiter.js");
  errorHandlerModule = await import("../../src/middleware/errorHandler.js");
});

afterEach(() => {
  rateLimiterModule._setGeneralWriteLimiterForTests(undefined);
  rateLimiterModule._setAuthNonceOrSiweLimiterForTests(undefined);
});

function buildTestApp(): Express {
  const app = express();
  app.get("/thing", rateLimiterModule.generalWriteLimiter, (_req, res) => res.status(200).json({ ok: true }));
  app.post("/thing", rateLimiterModule.generalWriteLimiter, (_req, res) => res.status(200).json({ ok: true }));
  app.post("/auth-like", rateLimiterModule.authNonceOrSiweLimiter, (_req, res) => res.status(200).json({ ok: true }));
  app.use(errorHandlerModule.errorHandler);
  return app;
}

describe("rateLimiter - generalWriteLimiter method filtering", () => {
  it("never consults the limiter for a GET request", async () => {
    const fake = new FakeRateLimiter();
    rateLimiterModule._setGeneralWriteLimiterForTests(fake);
    const app = buildTestApp();

    const res = await request(app).get("/thing");
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(0);
  });

  it("consults the limiter for a POST request", async () => {
    const fake = new FakeRateLimiter();
    rateLimiterModule._setGeneralWriteLimiterForTests(fake);
    const app = buildTestApp();

    const res = await request(app).post("/thing");
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("rateLimiter - 429 response shape", () => {
  it("returns 429 with the same { error: { code, message } } shape as errorHandler.ts, plus Retry-After", async () => {
    const fake = new FakeRateLimiter();
    fake.mode = "exceeded";
    rateLimiterModule._setGeneralWriteLimiterForTests(fake);
    const app = buildTestApp();

    const res = await request(app).post("/thing");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBe("5");
  });
});

describe("rateLimiter - fails open on infra error", () => {
  it("still allows the request through (200) when the limiter itself errors", async () => {
    const fake = new FakeRateLimiter();
    fake.mode = "infra-error";
    rateLimiterModule._setGeneralWriteLimiterForTests(fake);
    const app = buildTestApp();

    const res = await request(app).post("/thing");
    expect(res.status).toBe(200);
  });
});

describe("rateLimiter - tiers are independent", () => {
  it("the auth-specific limiter being over quota doesn't affect the general write limiter", async () => {
    const generalFake = new FakeRateLimiter();
    const authFake = new FakeRateLimiter();
    authFake.mode = "exceeded";
    rateLimiterModule._setGeneralWriteLimiterForTests(generalFake);
    rateLimiterModule._setAuthNonceOrSiweLimiterForTests(authFake);
    const app = buildTestApp();

    const authRes = await request(app).post("/auth-like");
    expect(authRes.status).toBe(429);

    const generalRes = await request(app).post("/thing");
    expect(generalRes.status).toBe(200);
    expect(generalFake.calls).toHaveLength(1);
  });
});

describe("rateLimiter - default behavior with no fake injected", () => {
  it("allows requests through untouched (NODE_ENV=test defaults both limiters to a no-op, never opening a real Redis connection)", async () => {
    const app = buildTestApp();

    const res = await request(app).post("/thing");
    expect(res.status).toBe(200);
  });
});