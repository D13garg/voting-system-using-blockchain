// Tests for GET /voters/me/elections (Voter Dashboard's data source,
// frontend Phase 4 / 2026-07-13 design doc - see admin.service.ts's
// getMyElectionStatuses for the approved cross-module-import decision
// this endpoint is built on). Same conventions as test/admin/admin.test.ts
// and test/election/election.test.ts: real in-memory MongoDB, real HTTP
// via supertest, real SIWE sessions, a fake IElectionContractClient
// (this one needs a WORKING hasVoted, unlike admin.test.ts's role-check-
// only fake, so it gets its own file + its own app instance rather than
// extending the shared one).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { SiweMessage } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type {
  CandidateData,
  ElectionData,
  IElectionContractClient,
  IVoterRegistryContractClient,
  TransactionResult,
} from "../../src/modules/blockchain/index.js";

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

/** Role-check-only for hasRole, but a REAL controllable hasVoted (this file's whole reason for existing separately from admin.test.ts). */
class FakeElectionContractClient implements IElectionContractClient {
  hasRoleResult = true;
  votedAddresses = new Set<string>(); // `${electionId}:${lowercased address}`

  getElection(): Promise<ElectionData> {
    throw new Error("not used by these tests");
  }
  getCandidate(): Promise<CandidateData> {
    throw new Error("not used by these tests");
  }
  async hasVoted(electionId: bigint, voter: `0x${string}`): Promise<boolean> {
    return this.votedAddresses.has(`${electionId.toString()}:${voter.toLowerCase()}`);
  }
  electionCount(): Promise<bigint> {
    throw new Error("not used by these tests");
  }
  isPaused(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  finalizeElection(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  async hasRole(): Promise<boolean> {
    return this.hasRoleResult;
  }
}

class FakeVoterRegistryContractClient implements IVoterRegistryContractClient {
  hasRoleResult = false;
  isRegisteredForElection(): Promise<boolean> {
    throw new Error("not used by these tests");
  }
  registerVoter(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  removeVoter(): Promise<TransactionResult> {
    throw new Error("not used by these tests");
  }
  async hasRole(): Promise<boolean> {
    return this.hasRoleResult;
  }
}

let mongod: MongoMemoryServer;
let app: Express;
let fakeElectionClient: FakeElectionContractClient;
let fakeVoterRegistryClient: FakeVoterRegistryContractClient;
let ElectionMetadataModel: typeof import("../../src/modules/election/election.model.js").ElectionMetadataModel;
let IndexedElectionModel: typeof import("../../src/modules/indexing/indexedElection.model.js").IndexedElectionModel;
let RegistrationRequestModel: typeof import("../../src/modules/admin/admin.model.js").RegistrationRequestModel;
let IndexedVoterRegistrationModel: typeof import("../../src/modules/indexing/indexedVoterRegistration.model.js").IndexedVoterRegistrationModel;
let SESSION_COOKIE_NAME: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const blockchain = await import("../../src/modules/blockchain/index.js");
  const electionModel = await import("../../src/modules/election/election.model.js");
  const indexedElectionModel = await import("../../src/modules/indexing/indexedElection.model.js");
  const adminModel = await import("../../src/modules/admin/admin.model.js");
  const indexedVoterRegistrationModel = await import("../../src/modules/indexing/indexedVoterRegistration.model.js");
  const authRoutes = await import("../../src/modules/auth/auth.routes.js");
  const appModule = await import("../../src/app.js");
  const dbConnection = await import("../../src/db/connection.js");

  ElectionMetadataModel = electionModel.ElectionMetadataModel;
  IndexedElectionModel = indexedElectionModel.IndexedElectionModel;
  RegistrationRequestModel = adminModel.RegistrationRequestModel;
  IndexedVoterRegistrationModel = indexedVoterRegistrationModel.IndexedVoterRegistrationModel;
  SESSION_COOKIE_NAME = authRoutes.SESSION_COOKIE_NAME;

  fakeElectionClient = new FakeElectionContractClient();
  blockchain._setElectionContractClientForTests(fakeElectionClient);
  fakeVoterRegistryClient = new FakeVoterRegistryContractClient();
  blockchain._setVoterRegistryContractClientForTests(fakeVoterRegistryClient);

  await dbConnection.connectDatabase();
  app = appModule.buildApp();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(() => {
  fakeElectionClient.hasRoleResult = true;
  fakeElectionClient.votedAddresses.clear();
  fakeVoterRegistryClient.hasRoleResult = false;
});

afterEach(async () => {
  await ElectionMetadataModel.deleteMany({});
  await IndexedElectionModel.deleteMany({});
  await RegistrationRequestModel.deleteMany({});
  await IndexedVoterRegistrationModel.deleteMany({});
});

async function seedElection(electionId: number, title: string): Promise<string> {
  const doc = await ElectionMetadataModel.create({
    title,
    description: "",
    electionId,
    linkTransactionHash: "0xabc",
    createdBy: "0xdead000000000000000000000000000000dead",
  });
  await IndexedElectionModel.create({
    electionId,
    title,
    startTime: BigInt(Math.floor(Date.now() / 1000) - 3600),
    endTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
    creator: "0xdead000000000000000000000000000000dead",
    finalized: false,
    finalizedBy: null,
    candidateIds: [],
  });
  return doc._id.toString();
}

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
  return { cookie, address: account.address };
}

describe("GET /voters/me/elections", () => {
  it("requires authentication", async () => {
    await request(app).get("/voters/me/elections").expect(401);
  });

  it("returns an empty list for a wallet with no relationship to any election", async () => {
    await seedElection(1, "Election One");
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/voters/me/elections").set("Cookie", cookie).expect(200);
    expect(res.body.elections).toEqual([]);
  });

  it("includes an election the wallet has a pending registration request for, with the Mongo draft id (not the on-chain electionId) for frontend routing", async () => {
    const mongoId = await seedElection(1, "Election One");
    const { cookie, address } = await getAuthenticatedCookie();
    await request(app).post("/voters/register-request").set("Cookie", cookie).send({ electionId: 1 }).expect(201);

    const res = await request(app).get("/voters/me/elections").set("Cookie", cookie).expect(200);
    expect(res.body.elections).toHaveLength(1);
    expect(res.body.elections[0]).toMatchObject({
      id: mongoId,
      electionId: 1,
      title: "Election One",
      registrationStatus: "pending",
      onChainConfirmed: false,
      hasVoted: false,
    });
    void address;
  });

  it("includes an election confirmed on-chain even with no registration request document (onChainConfirmed OR clause)", async () => {
    await seedElection(2, "Election Two");
    const { cookie, address } = await getAuthenticatedCookie();
    await IndexedVoterRegistrationModel.create({ electionId: 2, voterAddress: address.toLowerCase(), registered: true });

    const res = await request(app).get("/voters/me/elections").set("Cookie", cookie).expect(200);
    expect(res.body.elections).toHaveLength(1);
    expect(res.body.elections[0]).toMatchObject({
      electionId: 2,
      registrationStatus: "not_requested",
      onChainConfirmed: true,
    });
  });

  it("includes an election the wallet has voted in, even with no registration record at all (hasVoted OR clause)", async () => {
    await seedElection(3, "Election Three");
    const { cookie, address } = await getAuthenticatedCookie();
    fakeElectionClient.votedAddresses.add(`3:${address.toLowerCase()}`);

    const res = await request(app).get("/voters/me/elections").set("Cookie", cookie).expect(200);
    expect(res.body.elections).toHaveLength(1);
    expect(res.body.elections[0]).toMatchObject({ electionId: 3, hasVoted: true, registrationStatus: "not_requested" });
  });

  it("never includes draft elections (electionId: null)", async () => {
    await ElectionMetadataModel.create({
      title: "Still a draft",
      description: "",
      electionId: null,
      linkTransactionHash: null,
      createdBy: "0xdead000000000000000000000000000000dead",
    });
    const { cookie } = await getAuthenticatedCookie();
    const res = await request(app).get("/voters/me/elections").set("Cookie", cookie).expect(200);
    expect(res.body.elections).toEqual([]);
  });
});