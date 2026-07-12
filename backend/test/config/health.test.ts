// Tests for /ready and /metrics (HANDOFF.md's "Newly discovered
// pre-frontend items", item 4). Same Mongo-free buildApp() pattern as
// swagger.test.ts's own header comment already explains in detail -
// buildApp() itself never opens a real MongoDB or Redis connection, so
// these tests can run in-sandbox without either backend actually being
// reachable. That's also exactly the case this file needs to exercise
// anyway: /ready's "not ready" (503) path, since neither dependency is
// actually connected in this test process.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";

const REQUIRED_ENV = {
  NODE_ENV: "test",
  RPC_URL_PRIMARY: "http://127.0.0.1:8545",
  RPC_URL_FALLBACK: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  CONTRACT_ADDRESS_ELECTION: "0x0000000000000000000000000000000000000001",
  CONTRACT_ADDRESS_VOTER_REGISTRY: "0x0000000000000000000000000000000000000002",
  MONGODB_URI: "mongodb://localhost:27017/unused-by-these-tests",
  REDIS_URL: "redis://127.0.0.1:6390",
  IPFS_API_KEY: "test-ipfs-key",
  IPFS_API_SECRET: "test-ipfs-secret",
  RESEND_API_KEY: "test-resend-key",
  SIWE_DOMAIN: "localhost:5173",
  SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
  FRONTEND_ORIGIN: "http://localhost:5173",
  SIWE_SESSION_TTL_SECONDS: "86400",
};

let app: Express;
let closeRedis: () => void;

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  const appModule = await import("../../src/app.js");
  const redisModule = await import("../../src/shared/redis.js");

  app = appModule.buildApp();
  // Force the lazily-constructed singleton into existence up front (same
  // as generalWriteLimiter already does when a real server boots), and
  // stop it retrying against an address nothing is listening on so this
  // test file doesn't leave a dangling reconnect loop / open handle
  // behind it.
  const connection = redisModule.getRedisConnection();
  closeRedis = () => connection.disconnect();
}, 30_000);

afterAll(() => {
  closeRedis?.();
});

describe("GET /health", () => {
  it("always returns 200 - pure liveness, checks nothing downstream", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /ready", () => {
  it("returns 503 with both checks false when neither MongoDB nor Redis is actually connected", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", checks: { mongo: false, redis: false } });
  });
});

describe("GET /metrics", () => {
  it("returns Prometheus text-exposition-format output with the expected metric names", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("process_uptime_seconds");
    expect(res.text).toContain("process_resident_memory_bytes");
    expect(res.text).toContain("process_heap_used_bytes");
    expect(res.text).toContain("process_heap_total_bytes");
    // Neither dependency is connected in this test process - see the
    // /ready describe block above - so this should read as unhealthy.
    expect(res.text).toContain("up 0");
  });
});