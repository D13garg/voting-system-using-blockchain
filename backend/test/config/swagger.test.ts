// Tests for Gap #2 (OpenAPI docs, HANDOFF.md). Uses the real buildApp()
// (not a standalone Express app like rateLimiter.test.ts) because the
// thing under test - which routes wrap which spec - is the actual
// wiring in app.ts, not isolated middleware behavior. No real MongoDB
// connection is needed: buildApp() itself never touches the database
// (only bootstrap() does, via connectDatabase() - see app.ts's own
// header comment on that split), and none of the domain routers query
// the database until a request actually reaches one of their handlers,
// which no test below does.
//
// NOTE on scope: this file only exercises the NODE_ENV=test case (docs
// mounted). It deliberately does NOT exercise the NODE_ENV=production
// case (docs absent) in-process, because app.ts's own module-level
// guard (`if (env.NODE_ENV !== "test") { bootstrap()... }`) would fire
// a REAL bootstrap - real connectDatabase(), real app.listen() - the
// moment app.ts is imported with NODE_ENV=production, which is both
// unsafe in a test run and outside what this test file is trying to
// verify. The production gate itself is a single trivial `if
// (env.NODE_ENV !== "production")` condition around the two route
// mounts in app.ts - reviewed, not separately covered here.

import { beforeAll, describe, expect, it } from "vitest";
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
    REDIS_URL: "redis://localhost:6379",
    IPFS_API_KEY: "test-ipfs-key",
    IPFS_API_SECRET: "test-ipfs-secret",
    RESEND_API_KEY: "test-resend-key",
    SIWE_DOMAIN: "localhost:5173",
    SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
    FRONTEND_ORIGIN: "http://localhost:5173",
};

let app: Express;

beforeAll(async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const appModule = await import("../../src/app.js");
    app = appModule.buildApp();
});

describe("GET /api-docs.json", () => {
    it("returns a valid-looking OpenAPI document", async () => {
        const res = await request(app).get("/api-docs.json");
        expect(res.status).toBe(200);
        expect(res.body.openapi).toBe("3.0.3");
        expect(res.body.info.title).toBe("Decentralized Voting System API");
    });

    it("includes paths sourced from real route JSDoc (e.g. /auth/nonce)", async () => {
        const res = await request(app).get("/api-docs.json");
        expect(res.status).toBe(200);
        expect(res.body.paths).toHaveProperty("/auth/nonce");
    });
});

describe("GET /api-docs", () => {
    it("serves the interactive Swagger UI (200, HTML)", async () => {
        const res = await request(app).get("/api-docs/");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/html/);
    });
});