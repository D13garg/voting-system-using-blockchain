// Tests for the IPFS module (POST /ipfs/upload).
//
// Same testing approach as every other domain module: real in-memory
// MongoDB (needed only because buildApp() wires up Auth, which this
// route depends on via requireAuth), real SIWE-authenticated sessions,
// real HTTP requests via supertest, and a fake IIpfsClient test double
// instead of a real call to Pinata - see PinataIpfsClient.ts's header
// comment for why a real call can't be verified in this sandbox.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { IIpfsClient, IpfsPinInput, IpfsPinResult } from "../../src/modules/ipfs/index.js";

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
  IPFS_GATEWAY_URL: "https://w3s.link",
  SIWE_DOMAIN: "localhost:5173",
  SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
  FRONTEND_ORIGIN: "http://localhost:5173",
  SIWE_SESSION_TTL_SECONDS: "86400",
};

/** Fake IIpfsClient - no real network call to Pinata, per this module's approved test approach. */
class FakeIpfsClient implements IIpfsClient {
  nextCid: string | undefined;
  shouldThrow: Error | undefined;
  calls: IpfsPinInput[] = [];

  async pinFile(input: IpfsPinInput): Promise<IpfsPinResult> {
    this.calls.push(input);
    if (this.shouldThrow) throw this.shouldThrow;
    return { cid: this.nextCid ?? "bafybeitestcid" };
  }
}

let mongod: MongoMemoryServer;
let app: Express;
let fakeClient: FakeIpfsClient;
let SESSION_COOKIE_NAME: string;
let IpfsError: typeof import("../../src/modules/ipfs/index.js").IpfsError;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const ipfsModule = await import("../../src/modules/ipfs/index.js");
  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;
  IpfsError = ipfsModule.IpfsError;

  fakeClient = new FakeIpfsClient();
  ipfsModule._setIpfsClientForTests(fakeClient);

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(() => {
  fakeClient.nextCid = undefined;
  fakeClient.shouldThrow = undefined;
  fakeClient.calls = [];
});

/** Full real SIWE flow -> a valid session cookie, same helper as the other modules' tests. */
async function getAuthenticatedCookie(): Promise<string> {
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
  return setCookie.find((c) => c.startsWith(SESSION_COOKIE_NAME))!;
}

describe("IPFS module - POST /ipfs/upload", () => {
  it("returns 401 with no session", async () => {
    const res = await request(app).post("/ipfs/upload").attach("image", Buffer.from("fake-png-bytes"), "photo.png");
    expect(res.status).toBe(401);
  });

  it("returns 400 when no image field is provided", async () => {
    const cookie = await getAuthenticatedCookie();
    const res = await request(app).post("/ipfs/upload").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IMAGE_REQUIRED");
  });

  it("returns 400 for an unsupported mime type", async () => {
    const cookie = await getAuthenticatedCookie();
    const res = await request(app)
      .post("/ipfs/upload")
      .set("Cookie", cookie)
      .attach("image", Buffer.from("not an image"), { filename: "notes.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect(fakeClient.calls).toHaveLength(0);
  });

  it("returns 400 when the file exceeds the size limit", async () => {
    const cookie = await getAuthenticatedCookie();
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    const res = await request(app)
      .post("/ipfs/upload")
      .set("Cookie", cookie)
      .attach("image", oversized, { filename: "huge.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IMAGE_TOO_LARGE");
    expect(fakeClient.calls).toHaveLength(0);
  });

  it("uploads a valid image and returns its cid and resolved url", async () => {
    const cookie = await getAuthenticatedCookie();
    fakeClient.nextCid = "bafybeigdyrztest123";
    const res = await request(app)
      .post("/ipfs/upload")
      .set("Cookie", cookie)
      .attach("image", Buffer.from("fake-png-bytes"), { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      cid: "bafybeigdyrztest123",
      url: "https://w3s.link/ipfs/bafybeigdyrztest123",
    });
    expect(fakeClient.calls).toHaveLength(1);
    expect(fakeClient.calls[0]?.mimeType).toBe("image/png");
    expect(fakeClient.calls[0]?.filename).toBe("photo.png");
  });

  it("returns 502 when the pinning provider fails", async () => {
    const cookie = await getAuthenticatedCookie();
    fakeClient.shouldThrow = new IpfsError("provider is down", undefined);
    const res = await request(app)
      .post("/ipfs/upload")
      .set("Cookie", cookie)
      .attach("image", Buffer.from("fake-png-bytes"), { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("IPFS_UPLOAD_FAILED");
  });
});