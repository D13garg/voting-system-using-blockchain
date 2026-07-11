// Tests for the Phase 6 worker's event-sync logic
// (src/modules/indexing/eventSync.ts).
//
// Real in-memory MongoDB (for IndexedVoteEvent/IndexedChainEvent/
// WorkerCheckpoint), a FAKE viem PublicClient (getBlockNumber/getLogs/
// getBlock only - the three methods eventSync.ts's code path actually
// calls) instead of a real chain or a real Hardhat node - same
// test-double philosophy as every domain module's fake contract client,
// applied one layer lower since syncEvent/syncAllEvents accept an
// optional `client` param for exactly this purpose (mirroring
// getNewLogs's own testability design in Phase 3).
//
// No supertest/HTTP here - this module has no routes, it's pure
// worker-side logic.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { keccak256, toBytes, type Log } from "viem";

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
  SIWE_SESSION_TTL_SECONDS: "86400",
  FRONTEND_ORIGIN: "http://localhost:5173",
  WORKER_START_BLOCK: "5",
};

/**
 * Fake viem PublicClient - only the 3 methods eventSync.ts's code path
 * actually calls (getBlockNumber for "what's the chain head", getLogs
 * for "give me this event's logs in this range", getBlock for "what time
 * was this block mined"). Cast to PublicClient at each call site, same
 * pragmatic-cast pattern documented in eventSync.ts itself - a full
 * structural implementation of viem's real PublicClient isn't reasonable
 * for a fake this narrow-purpose.
 */
class FakePublicClient {
  blockNumber = 100n;
  logsByEventName = new Map<string, Log[]>();
  blockTimestamps = new Map<bigint, bigint>();
  failEventNames = new Set<string>();
  getBlockCallCount = 0;

  async getBlockNumber(): Promise<bigint> {
    return this.blockNumber;
  }

  async getLogs(params: { event: { name?: string }; fromBlock: bigint; toBlock: bigint }): Promise<Log[]> {
    const eventName = params.event.name;
    if (eventName && this.failEventNames.has(eventName)) {
      throw new Error(`simulated RPC failure for ${eventName}`);
    }
    const all = eventName ? (this.logsByEventName.get(eventName) ?? []) : [];
    return all.filter((log) => log.blockNumber! >= params.fromBlock && log.blockNumber! <= params.toBlock);
  }

  async getBlock({ blockNumber }: { blockNumber: bigint }): Promise<{ timestamp: bigint }> {
    this.getBlockCallCount++;
    return { timestamp: this.blockTimestamps.get(blockNumber) ?? 0n };
  }
}

function makeLog(overrides: {
  eventName: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
  args: Record<string, unknown>;
}): Log {
  return {
    address: "0x0000000000000000000000000000000000000001",
    blockHash: "0x" + "a".repeat(64),
    blockNumber: overrides.blockNumber,
    data: "0x",
    logIndex: overrides.logIndex,
    removed: false,
    topics: [],
    transactionHash: overrides.transactionHash,
    transactionIndex: 0,
    // Cast needed: real viem Log<> only carries `args`/`eventName` when
    // parameterized by a specific AbiEvent (see eventSync.ts's own
    // "TYPING NOTE"). This fake constructs exactly what the real decoded
    // shape would contain at runtime.
    ...({ args: overrides.args, eventName: overrides.eventName } as object),
  } as unknown as Log;
}

let mongod: MongoMemoryServer;
let fakeClient: FakePublicClient;
let syncEvent: typeof import("../../src/modules/indexing/eventSync.js").syncEvent;
let syncAllEvents: typeof import("../../src/modules/indexing/eventSync.js").syncAllEvents;
let EVENT_SYNC_DEFINITIONS: typeof import("../../src/modules/indexing/eventDefinitions.js").EVENT_SYNC_DEFINITIONS;
let IndexedVoteEventModel: typeof import("../../src/modules/indexing/indexedVoteEvent.model.js").IndexedVoteEventModel;
let IndexedChainEventModel: typeof import("../../src/modules/indexing/indexedChainEvent.model.js").IndexedChainEventModel;
let IndexedElectionModel: typeof import("../../src/modules/indexing/indexedElection.model.js").IndexedElectionModel;
let IndexedVoterRegistrationModel: typeof import("../../src/modules/indexing/indexedVoterRegistration.model.js").IndexedVoterRegistrationModel;
let WorkerCheckpointModel: typeof import("../../src/modules/indexing/checkpoint.model.js").WorkerCheckpointModel;
let NotificationPreferenceModel: typeof import("../../src/modules/notifications/notificationPreference.model.js").NotificationPreferenceModel;
let AuditLogModel: typeof import("../../src/modules/audit/audit.model.js").AuditLogModel;

/**
 * Fake IJobQueue<T> - same purpose as ipfs.test.ts's FakeIpfsClient: lets
 * this file exercise the enqueueRollupRecompute/
 * enqueueElectionFinalizedNotifications calls eventSync.ts now makes
 * (Phase 7(b)) with no real Redis connection. See analytics.queue.ts's
 * and notification.queue.ts's own header comments for why IJobQueue<T>
 * exists as exactly this minimal an interface.
 */
class FakeJobQueue<T> {
  calls: { name: string; data: T; opts: unknown }[] = [];
  async add(name: string, data: T, opts: unknown): Promise<unknown> {
    this.calls.push({ name, data, opts });
    return { id: "fake-job-id" };
  }
}

let fakeAnalyticsQueue: FakeJobQueue<{ electionId: number }>;
let fakeNotificationQueue: FakeJobQueue<{ to: string; subject: string; html: string }>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, REQUIRED_ENV, { MONGODB_URI: mongod.getUri() });

  const eventSyncModule = await import("../../src/modules/indexing/eventSync.js");
  const eventDefinitionsModule = await import("../../src/modules/indexing/eventDefinitions.js");
  const indexedVoteEventModule = await import("../../src/modules/indexing/indexedVoteEvent.model.js");
  const indexedChainEventModule = await import("../../src/modules/indexing/indexedChainEvent.model.js");
  const indexedElectionModule = await import("../../src/modules/indexing/indexedElection.model.js");
  const indexedVoterRegistrationModule = await import("../../src/modules/indexing/indexedVoterRegistration.model.js");
  const checkpointModule = await import("../../src/modules/indexing/checkpoint.model.js");
  const analyticsQueueModule = await import("../../src/modules/analytics/analytics.queue.js");
  const notificationQueueModule = await import("../../src/modules/notifications/notification.queue.js");
  const notificationPreferenceModule = await import("../../src/modules/notifications/notificationPreference.model.js");
  const auditModelModule = await import("../../src/modules/audit/audit.model.js");
  const dbConnection = await import("../../src/db/connection.js");

  syncEvent = eventSyncModule.syncEvent;
  syncAllEvents = eventSyncModule.syncAllEvents;
  EVENT_SYNC_DEFINITIONS = eventDefinitionsModule.EVENT_SYNC_DEFINITIONS;
  IndexedVoteEventModel = indexedVoteEventModule.IndexedVoteEventModel;
  IndexedChainEventModel = indexedChainEventModule.IndexedChainEventModel;
  IndexedElectionModel = indexedElectionModule.IndexedElectionModel;
  IndexedVoterRegistrationModel = indexedVoterRegistrationModule.IndexedVoterRegistrationModel;
  WorkerCheckpointModel = checkpointModule.WorkerCheckpointModel;
  NotificationPreferenceModel = notificationPreferenceModule.NotificationPreferenceModel;
  AuditLogModel = auditModelModule.AuditLogModel;

  fakeAnalyticsQueue = new FakeJobQueue();
  fakeNotificationQueue = new FakeJobQueue();
  analyticsQueueModule._setAnalyticsRollupQueueForTests(fakeAnalyticsQueue);
  notificationQueueModule._setNotificationDispatchQueueForTests(fakeNotificationQueue);

  await dbConnection.connectDatabase();
}, 300_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  fakeClient = new FakePublicClient();
  fakeAnalyticsQueue.calls = [];
  fakeNotificationQueue.calls = [];
  await IndexedVoteEventModel.deleteMany({});
  await IndexedChainEventModel.deleteMany({});
  await IndexedElectionModel.deleteMany({});
  await IndexedVoterRegistrationModel.deleteMany({});
  await WorkerCheckpointModel.deleteMany({});
  await NotificationPreferenceModel.deleteMany({});
  await AuditLogModel.deleteMany({});
});

function def(key: string) {
  const found = EVENT_SYNC_DEFINITIONS.find((d) => d.key === key);
  if (!found) throw new Error(`test setup error: no definition for ${key}`);
  return found;
}

describe("eventSync - VoteCast", () => {
  it("persists a new VoteCast log to IndexedVoteEventModel with a real block timestamp", async () => {
    fakeClient.blockTimestamps.set(10n, 1_700_000_000n);
    fakeClient.logsByEventName.set("VoteCast", [
      makeLog({
        eventName: "VoteCast",
        blockNumber: 10n,
        transactionHash: "0x" + "a".repeat(64),
        logIndex: 0,
        args: { electionId: 0n, voter: "0xvoter1", candidateId: 1n },
      }),
    ]);

    const result = await syncEvent(def("Election:VoteCast"), fakeClient as any);
    expect(result.processed).toBe(1);

    const docs = await IndexedVoteEventModel.find({});
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      electionId: 0,
      voterAddress: "0xvoter1",
      candidateId: 1,
      txHash: "0x" + "a".repeat(64),
      logIndex: 0,
    });
    expect(docs[0]!.timestamp.getTime()).toBe(1_700_000_000_000);
  });

  it("enqueues an analytics rollup recompute for the election (Phase 7(b))", async () => {
    fakeClient.logsByEventName.set("VoteCast", [
      makeLog({
        eventName: "VoteCast",
        blockNumber: 10n,
        transactionHash: "0x" + "e".repeat(64),
        logIndex: 0,
        args: { electionId: 7n, voter: "0xvoter3", candidateId: 2n },
      }),
    ]);

    await syncEvent(def("Election:VoteCast"), fakeClient as any);

    expect(fakeAnalyticsQueue.calls).toHaveLength(1);
    expect(fakeAnalyticsQueue.calls[0]?.data).toEqual({ electionId: 7 });
  });

  it("is idempotent: re-processing the same log (at-least-once overlap) does not create a duplicate", async () => {
    const log = makeLog({
      eventName: "VoteCast",
      blockNumber: 10n,
      transactionHash: "0x" + "b".repeat(64),
      logIndex: 2,
      args: { electionId: 0n, voter: "0xvoter2", candidateId: 0n },
    });
    fakeClient.logsByEventName.set("VoteCast", [log]);

    await syncEvent(def("Election:VoteCast"), fakeClient as any);
    // Simulate the checkpoint overlap described in events.ts's header
    // comment: force the checkpoint back so the same log is fetched again.
    await WorkerCheckpointModel.findOneAndUpdate({ eventKey: "Election:VoteCast" }, { lastProcessedBlock: 9n });
    await syncEvent(def("Election:VoteCast"), fakeClient as any);

    const count = await IndexedVoteEventModel.countDocuments({ txHash: "0x" + "b".repeat(64), logIndex: 2 });
    expect(count).toBe(1);
  });

  it("advances the checkpoint to the chain's current head after a successful sync", async () => {
    fakeClient.blockNumber = 42n;
    await syncEvent(def("Election:VoteCast"), fakeClient as any);

    const checkpoint = await WorkerCheckpointModel.findOne({ eventKey: "Election:VoteCast" });
    expect(checkpoint?.lastProcessedBlock).toBe(42n);
  });

  it("defaults to WORKER_START_BLOCK when no checkpoint exists yet", async () => {
    // WORKER_START_BLOCK is "5" in REQUIRED_ENV - a log at block 4 is
    // below that and must never be returned (getLogs is called with
    // fromBlock=5), a log at exactly block 5 (inclusive) must be.
    fakeClient.logsByEventName.set("VoteCast", [
      makeLog({ eventName: "VoteCast", blockNumber: 4n, transactionHash: "0x" + "c".repeat(64), logIndex: 0, args: { electionId: 0n, voter: "0xa", candidateId: 0n } }),
      makeLog({ eventName: "VoteCast", blockNumber: 5n, transactionHash: "0x" + "d".repeat(64), logIndex: 0, args: { electionId: 0n, voter: "0xb", candidateId: 0n } }),
    ]);

    await syncEvent(def("Election:VoteCast"), fakeClient as any);

    const docs = await IndexedVoteEventModel.find({});
    expect(docs).toHaveLength(1);
    expect(docs[0]!.txHash).toBe("0x" + "d".repeat(64));
  });
});

describe("eventSync - generic events (e.g. CandidateAdded)", () => {
  it("persists a non-VoteCast event to IndexedChainEventModel with stringified bigint args", async () => {
    fakeClient.logsByEventName.set("CandidateAdded", [
      makeLog({
        eventName: "CandidateAdded",
        blockNumber: 10n,
        transactionHash: "0x" + "e".repeat(64),
        logIndex: 1,
        args: { electionId: 3n, candidateId: 2n, name: "Alice", metadataURI: "ipfs://alice" },
      }),
    ]);

    await syncEvent(def("Election:CandidateAdded"), fakeClient as any);

    const docs = await IndexedChainEventModel.find({});
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      eventName: "CandidateAdded",
      contractName: "Election",
      electionId: 3,
      txHash: "0x" + "e".repeat(64),
    });
    // bigints stringified, not stored raw - see serializeArgs's header comment.
    expect(docs[0]!.args).toEqual({ electionId: "3", candidateId: "2", name: "Alice", metadataURI: "ipfs://alice" });
  });
});

describe("eventSync - IndexedElection dual-write (decision (a) continuation, Election module migration)", () => {
  it("ElectionCreated dual-writes into both IndexedChainEventModel (unchanged) and IndexedElectionModel (new)", async () => {
    fakeClient.logsByEventName.set("ElectionCreated", [
      makeLog({
        eventName: "ElectionCreated",
        blockNumber: 10n,
        transactionHash: "0x" + "1".repeat(64),
        logIndex: 0,
        args: { electionId: 5n, title: "Student Council", startTime: 100n, endTime: 200n, creator: "0xcreator" },
      }),
    ]);

    await syncEvent(def("Election:ElectionCreated"), fakeClient as any);

    // Still lands in the generic log exactly as before - dual-write, not
    // replace (the approved fork - see indexedElection.model.ts).
    const genericDocs = await IndexedChainEventModel.find({ eventName: "ElectionCreated" });
    expect(genericDocs).toHaveLength(1);

    const mirror = await IndexedElectionModel.findOne({ electionId: 5 });
    expect(mirror).toMatchObject({
      electionId: 5,
      title: "Student Council",
      startTime: 100n,
      endTime: 200n,
      creator: "0xcreator",
      finalized: false,
      candidateIds: [],
    });
  });

  it("CandidateAdded uses $addToSet - idempotent under redelivery, no duplicate candidateIds", async () => {
    const log = makeLog({
      eventName: "CandidateAdded",
      blockNumber: 10n,
      transactionHash: "0x" + "2".repeat(64),
      logIndex: 0,
      args: { electionId: 5n, candidateId: 3n, name: "Alice", metadataURI: "ipfs://alice" },
    });
    fakeClient.logsByEventName.set("CandidateAdded", [log]);

    await syncEvent(def("Election:CandidateAdded"), fakeClient as any);
    // Simulate the same at-least-once redelivery scenario the existing
    // VoteCast idempotency test uses.
    await WorkerCheckpointModel.findOneAndUpdate({ eventKey: "Election:CandidateAdded" }, { lastProcessedBlock: 9n });
    await syncEvent(def("Election:CandidateAdded"), fakeClient as any);

    const mirror = await IndexedElectionModel.findOne({ electionId: 5 });
    expect(mirror?.candidateIds).toEqual([3]); // not [3, 3]
  });

  it("ElectionFinalized sets finalized/finalizedBy on the mirror, enqueues a final rollup recompute, and fans out notifications to subscribers (Phase 7(b))", async () => {
    // A prior ElectionCreated is what gives this election its title -
    // needed so the notification email's subject reflects it, not the
    // `Election #<id>` defensive fallback.
    await IndexedElectionModel.create({ electionId: 5, title: "Student Council 2026", finalized: false, candidateIds: [] });
    await NotificationPreferenceModel.create({ electionId: 5, walletAddress: "0xvoter1", email: "voter1@example.com" });
    await NotificationPreferenceModel.create({ electionId: 5, walletAddress: "0xvoter2", email: "voter2@example.com" });

    fakeClient.logsByEventName.set("ElectionFinalized", [
      makeLog({
        eventName: "ElectionFinalized",
        blockNumber: 10n,
        transactionHash: "0x" + "3".repeat(64),
        logIndex: 0,
        args: { electionId: 5n, finalizedBy: "0xadmin" },
      }),
    ]);

    await syncEvent(def("Election:ElectionFinalized"), fakeClient as any);

    const mirror = await IndexedElectionModel.findOne({ electionId: 5 });
    expect(mirror).toMatchObject({ electionId: 5, finalized: true, finalizedBy: "0xadmin" });

    expect(fakeAnalyticsQueue.calls).toHaveLength(1);
    expect(fakeAnalyticsQueue.calls[0]?.data).toEqual({ electionId: 5 });

    expect(fakeNotificationQueue.calls).toHaveLength(2);
    const recipients = fakeNotificationQueue.calls.map((c) => c.data.to).sort();
    expect(recipients).toEqual(["voter1@example.com", "voter2@example.com"]);
    expect(fakeNotificationQueue.calls[0]?.data.subject).toContain("Student Council 2026");
  });

  it("handles CandidateAdded arriving before ElectionCreated (independent per-event-type checkpoints) - the partial doc is later filled in correctly", async () => {
    // CandidateAdded processed first - creates a partial doc.
    fakeClient.logsByEventName.set("CandidateAdded", [
      makeLog({
        eventName: "CandidateAdded",
        blockNumber: 10n,
        transactionHash: "0x" + "4".repeat(64),
        logIndex: 0,
        args: { electionId: 9n, candidateId: 0n, name: "Bob", metadataURI: "ipfs://bob" },
      }),
    ]);
    await syncEvent(def("Election:CandidateAdded"), fakeClient as any);

    let mirror = await IndexedElectionModel.findOne({ electionId: 9 });
    expect(mirror?.candidateIds).toEqual([0]);
    expect(mirror?.title).toBeUndefined(); // still partial - see the model's header comment

    // ElectionCreated arrives on a later poll - must fill in the
    // remaining fields on the SAME document, not create a second one.
    fakeClient.logsByEventName.set("ElectionCreated", [
      makeLog({
        eventName: "ElectionCreated",
        blockNumber: 10n,
        transactionHash: "0x" + "5".repeat(64),
        logIndex: 0,
        args: { electionId: 9n, title: "Late-Arriving Title", startTime: 1n, endTime: 2n, creator: "0xcreator" },
      }),
    ]);
    await syncEvent(def("Election:ElectionCreated"), fakeClient as any);

    const allDocs = await IndexedElectionModel.find({ electionId: 9 });
    expect(allDocs).toHaveLength(1); // still one document, not two
    mirror = allDocs[0]!;
    expect(mirror.title).toBe("Late-Arriving Title");
    expect(mirror.candidateIds).toEqual([0]); // untouched by the later fill-in
  });
});

describe("eventSync - IndexedVoterRegistration dual-write (decision (a) continuation, Admin module migration)", () => {
  it("VoterRegistered sets registered:true on the mirror, lowercasing the voter address", async () => {
    fakeClient.logsByEventName.set("VoterRegistered", [
      makeLog({
        eventName: "VoterRegistered",
        blockNumber: 10n,
        transactionHash: "0x" + "6".repeat(64),
        logIndex: 0,
        args: { electionId: 1n, voter: "0xABCDEF0000000000000000000000000000ABCD", registeredBy: "0xadmin" },
      }),
    ]);

    await syncEvent(def("VoterRegistry:VoterRegistered"), fakeClient as any);

    const mirror = await IndexedVoterRegistrationModel.findOne({ electionId: 1 });
    expect(mirror).toMatchObject({
      electionId: 1,
      voterAddress: "0xabcdef0000000000000000000000000000abcd",
      registered: true,
    });

    // Still dual-writes into the generic log too, same as Election's mirror.
    const genericDocs = await IndexedChainEventModel.find({ eventName: "VoterRegistered" });
    expect(genericDocs).toHaveLength(1);
  });

  it("VoterRemoved sets registered:false on an existing mirror doc", async () => {
    await IndexedVoterRegistrationModel.create({
      electionId: 1,
      voterAddress: "0xvoter1",
      registered: true,
      lastEventBlockNumber: 5n,
      lastEventLogIndex: 0,
    });
    fakeClient.logsByEventName.set("VoterRemoved", [
      makeLog({
        eventName: "VoterRemoved",
        blockNumber: 10n,
        transactionHash: "0x" + "7".repeat(64),
        logIndex: 0,
        args: { electionId: 1n, voter: "0xvoter1", removedBy: "0xadmin" },
      }),
    ]);

    await syncEvent(def("VoterRegistry:VoterRemoved"), fakeClient as any);

    const mirror = await IndexedVoterRegistrationModel.findOne({ electionId: 1, voterAddress: "0xvoter1" });
    expect(mirror?.registered).toBe(false);
  });

  it("resolves out-of-order delivery correctly: a later-chain-order VoterRemoved processed BEFORE an earlier VoterRegistered must not be overwritten by it", async () => {
    // Simulates VoterRegistered's checkpoint lagging behind
    // VoterRemoved's - see indexedVoterRegistration.model.ts's header
    // comment on why this is a real, not hypothetical, scenario (the two
    // event types sync on independent checkpoints).
    //
    // Chain reality: registered at block 5, removed at block 10. If
    // VoterRemoved (block 10) is processed FIRST, then a stale
    // VoterRegistered (block 5) arrives SECOND, the final state must
    // still be "removed" (registered: false) - not overwritten back to
    // true just because it was processed later in wall-clock time.
    fakeClient.logsByEventName.set("VoterRemoved", [
      makeLog({
        eventName: "VoterRemoved",
        blockNumber: 10n,
        transactionHash: "0x" + "8".repeat(64),
        logIndex: 0,
        args: { electionId: 2n, voter: "0xvoter2", removedBy: "0xadmin" },
      }),
    ]);
    await syncEvent(def("VoterRegistry:VoterRemoved"), fakeClient as any);

    fakeClient.logsByEventName.set("VoterRegistered", [
      makeLog({
        eventName: "VoterRegistered",
        blockNumber: 5n,
        transactionHash: "0x" + "9".repeat(64),
        logIndex: 0,
        args: { electionId: 2n, voter: "0xvoter2", registeredBy: "0xadmin" },
      }),
    ]);
    await syncEvent(def("VoterRegistry:VoterRegistered"), fakeClient as any);

    const mirror = await IndexedVoterRegistrationModel.findOne({ electionId: 2, voterAddress: "0xvoter2" });
    expect(mirror?.registered).toBe(false); // still removed - the stale, older event was correctly ignored
    expect(mirror?.lastEventBlockNumber).toBe(10n); // unchanged - block 10 is still the newest applied event
  });

  it("is idempotent under redelivery: re-processing the same VoterRegistered log does not toggle or duplicate anything", async () => {
    const log = makeLog({
      eventName: "VoterRegistered",
      blockNumber: 10n,
      transactionHash: "0x" + "a".repeat(64) + "1",
      logIndex: 0,
      args: { electionId: 3n, voter: "0xvoter3", registeredBy: "0xadmin" },
    });
    fakeClient.logsByEventName.set("VoterRegistered", [log]);

    await syncEvent(def("VoterRegistry:VoterRegistered"), fakeClient as any);
    await WorkerCheckpointModel.findOneAndUpdate({ eventKey: "VoterRegistry:VoterRegistered" }, { lastProcessedBlock: 9n });
    await syncEvent(def("VoterRegistry:VoterRegistered"), fakeClient as any);

    const docs = await IndexedVoterRegistrationModel.find({ electionId: 3 });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.registered).toBe(true);
  });
});

describe("eventSync - AuditLog (Section 17)", () => {
  const ELECTION_ADMIN_ROLE_HASH = keccak256(toBytes("ELECTION_ADMINISTRATOR_ROLE"));

  it("RoleGranted persists a ROLE_GRANTED audit entry with the role name resolved, not the raw hash", async () => {
    fakeClient.logsByEventName.set("RoleGranted", [
      makeLog({
        eventName: "RoleGranted",
        blockNumber: 10n,
        transactionHash: "0x" + "6".repeat(64),
        logIndex: 0,
        args: { role: ELECTION_ADMIN_ROLE_HASH, account: "0xnewadmin", sender: "0xsysadmin" },
      }),
    ]);

    await syncEvent(def("Election:RoleGranted"), fakeClient as any);

    const entries = await AuditLogModel.find({});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: "ROLE_GRANTED",
      source: "on-chain",
      actor: "0xsysadmin",
      subject: "0xnewadmin",
      contractName: "Election",
      role: "ELECTION_ADMINISTRATOR_ROLE",
      txHash: "0x" + "6".repeat(64),
    });

    // Deliberately does NOT also land in IndexedChainEventModel - see
    // AUDIT_ROLE_KEYS's comment on why role events skip that path
    // entirely (no electionId to satisfy its required schema field).
    const genericDocs = await IndexedChainEventModel.find({ eventName: "RoleGranted" });
    expect(genericDocs).toHaveLength(0);
  });

  it("RoleRevoked persists a ROLE_REVOKED audit entry", async () => {
    fakeClient.logsByEventName.set("RoleRevoked", [
      makeLog({
        eventName: "RoleRevoked",
        blockNumber: 10n,
        transactionHash: "0x" + "7".repeat(64),
        logIndex: 0,
        args: { role: ELECTION_ADMIN_ROLE_HASH, account: "0xformeradmin", sender: "0xsysadmin" },
      }),
    ]);

    await syncEvent(def("VoterRegistry:RoleRevoked"), fakeClient as any);

    const entries = await AuditLogModel.find({});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: "ROLE_REVOKED",
      contractName: "VoterRegistry",
      role: "ELECTION_ADMINISTRATOR_ROLE",
      subject: "0xformeradmin",
    });
  });

  it("is idempotent under redelivery (at-least-once), same discipline as every other mirror in this file", async () => {
    fakeClient.logsByEventName.set("RoleGranted", [
      makeLog({
        eventName: "RoleGranted",
        blockNumber: 10n,
        transactionHash: "0x" + "8".repeat(64),
        logIndex: 0,
        args: { role: ELECTION_ADMIN_ROLE_HASH, account: "0xnewadmin", sender: "0xsysadmin" },
      }),
    ]);

    await syncEvent(def("Election:RoleGranted"), fakeClient as any);
    await WorkerCheckpointModel.findOneAndUpdate({ eventKey: "Election:RoleGranted" }, { lastProcessedBlock: 9n });
    await syncEvent(def("Election:RoleGranted"), fakeClient as any);

    const entries = await AuditLogModel.find({});
    expect(entries).toHaveLength(1); // not 2
  });

  it("ElectionCreated also records an ELECTION_CREATED audit entry (in addition to the existing IndexedElection mirror write)", async () => {
    fakeClient.logsByEventName.set("ElectionCreated", [
      makeLog({
        eventName: "ElectionCreated",
        blockNumber: 10n,
        transactionHash: "0x" + "9".repeat(64),
        logIndex: 0,
        args: { electionId: 7n, title: "Board Election", startTime: 100n, endTime: 200n, creator: "0xcreator" },
      }),
    ]);

    await syncEvent(def("Election:ElectionCreated"), fakeClient as any);

    const entries = await AuditLogModel.find({ category: "ELECTION_CREATED" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: "0xcreator", electionId: 7, contractName: "Election" });
    expect(entries[0]?.metadata).toMatchObject({ title: "Board Election" });
  });

  it("ElectionFinalized also records an ELECTION_FINALIZED audit entry", async () => {
    await IndexedElectionModel.create({ electionId: 7, title: "Board Election", finalized: false, candidateIds: [] });
    fakeClient.logsByEventName.set("ElectionFinalized", [
      makeLog({
        eventName: "ElectionFinalized",
        blockNumber: 10n,
        transactionHash: "0x" + "c".repeat(64),
        logIndex: 0,
        args: { electionId: 7n, finalizedBy: "0xadmin" },
      }),
    ]);

    await syncEvent(def("Election:ElectionFinalized"), fakeClient as any);

    const entries = await AuditLogModel.find({ category: "ELECTION_FINALIZED" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: "0xadmin", electionId: 7 });
  });
});

describe("eventSync - BlockTimestampCache", () => {
  it("only calls getBlock once per unique block number across multiple logs in the same block", async () => {
    fakeClient.blockTimestamps.set(10n, 1_700_000_000n);
    fakeClient.logsByEventName.set("VoteCast", [
      makeLog({ eventName: "VoteCast", blockNumber: 10n, transactionHash: "0x" + "1".repeat(64), logIndex: 0, args: { electionId: 0n, voter: "0xa", candidateId: 0n } }),
      makeLog({ eventName: "VoteCast", blockNumber: 10n, transactionHash: "0x" + "2".repeat(64), logIndex: 1, args: { electionId: 0n, voter: "0xb", candidateId: 0n } }),
    ]);

    await syncEvent(def("Election:VoteCast"), fakeClient as any);

    expect(fakeClient.getBlockCallCount).toBe(1);
  });
});

describe("syncAllEvents", () => {
  it("processes all 10 event definitions and returns a result for each", async () => {
    const results = await syncAllEvents(fakeClient as any);
    expect(Object.keys(results).sort()).toEqual(
      [
        "Election:ElectionCreated",
        "Election:CandidateAdded",
        "Election:VoteCast",
        "Election:ElectionFinalized",
        "Election:RoleGranted",
        "Election:RoleRevoked",
        "VoterRegistry:VoterRegistered",
        "VoterRegistry:VoterRemoved",
        "VoterRegistry:RoleGranted",
        "VoterRegistry:RoleRevoked",
      ].sort(),
    );
    expect(Object.values(results).every((v) => v === 0)).toBe(true);
  });

  it("isolates one event's failure - other events still sync successfully and advance their checkpoints", async () => {
    fakeClient.failEventNames.add("VoteCast");
    fakeClient.blockNumber = 77n;

    const results = await syncAllEvents(fakeClient as any);
    expect(results["Election:VoteCast"]).toBe(0);
    expect(results["Election:CandidateAdded"]).toBe(0);

    const failedCheckpoint = await WorkerCheckpointModel.findOne({ eventKey: "Election:VoteCast" });
    expect(failedCheckpoint).toBeNull(); // never advanced - the failure happened before saveCheckpoint

    const healthyCheckpoint = await WorkerCheckpointModel.findOne({ eventKey: "Election:CandidateAdded" });
    expect(healthyCheckpoint?.lastProcessedBlock).toBe(77n);
  });
});