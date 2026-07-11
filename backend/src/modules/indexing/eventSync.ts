// The worker's event-sync logic (architecture Section 8, ADR-002). This
// is the piece every other domain module's "no worker yet" TODOs have
// been waiting on - see HANDOFF.md for the full design-fork discussion
// (the RegistrationRequest.status conflict resolved in Admin's favor,
// and the decision to build this write side as its own milestone before
// migrating any module's reads).
//
// Deliberately built on top of modules/blockchain/events.ts's existing
// getNewLogs() rather than any new polling mechanism - that helper was
// built in Phase 3 specifically for this worker to use, and its
// at-least-once-delivery contract (see its own header comment) is why
// every write below goes through an idempotent upsert keyed on
// {txHash, logIndex}, never a plain insert.
//
// TYPING NOTE: getNewLogs() returns the bare viem `Log[]` type (no
// `.args`), because it's deliberately contract/event-agnostic (Phase 3's
// design - see its own header comment on why `event` is a generic
// parameter). The event ABI items in eventDefinitions.ts are built with
// parseAbiItem() specifically so each handler function below can cast
// the returned logs to the properly-decoded `Log<..., typeof someEvent>`
// shape before reading `.args` - a narrow, deliberate, single-purpose
// cast (documented here rather than a `Record<string, unknown>` grab-bag
// that would need still more unsafe casts inside every handler).

import type { Log, PublicClient } from "viem";
import { getNewLogs } from "../blockchain/events.js";
import { getPublicClient } from "../blockchain/provider.js";
import { logger } from "../../shared/logger.js";
import { enqueueRollupRecompute } from "../analytics/analytics.queue.js";
import { enqueueElectionFinalizedNotifications } from "../notifications/notification.service.js";
import { recordAuditLog } from "../audit/audit.service.js";
import { IndexedVoteEventModel } from "./indexedVoteEvent.model.js";
import { IndexedChainEventModel } from "./indexedChainEvent.model.js";
import { IndexedElectionModel } from "./indexedElection.model.js";
import { IndexedCandidateModel } from "./indexedCandidate.model.js";
import { IndexedVoterRegistrationModel } from "./indexedVoterRegistration.model.js";
import { WorkerCheckpointModel } from "./checkpoint.model.js";
import { env } from "../../config/env.js";
import {
  EVENT_SYNC_DEFINITIONS,
  voteCastEvent,
  electionCreatedEvent,
  candidateAddedEvent,
  electionFinalizedEvent,
  voterRegisteredEvent,
  voterRemovedEvent,
  roleGrantedEvent,
  roleRevokedEvent,
  roleNameFromHash,
  type EventSyncDefinition,
} from "./eventDefinitions.js";

type VoteCastLog = Log<bigint, number, false, typeof voteCastEvent>;
type ElectionCreatedLog = Log<bigint, number, false, typeof electionCreatedEvent>;
type CandidateAddedLog = Log<bigint, number, false, typeof candidateAddedEvent>;
type ElectionFinalizedLog = Log<bigint, number, false, typeof electionFinalizedEvent>;
type VoterRegisteredLog = Log<bigint, number, false, typeof voterRegisteredEvent>;
type VoterRemovedLog = Log<bigint, number, false, typeof voterRemovedEvent>;
type RoleGrantedLog = Log<bigint, number, false, typeof roleGrantedEvent>;
type RoleRevokedLog = Log<bigint, number, false, typeof roleRevokedEvent>;

/**
 * The 3 event keys that dual-write into IndexedElection, in addition to
 * their existing generic IndexedChainEvent write - see
 * indexedElection.model.ts's header comment for the dual-write decision.
 */
const ELECTION_MIRROR_KEYS = new Set<string>([
  "Election:ElectionCreated",
  "Election:CandidateAdded",
  "Election:ElectionFinalized",
]);

/**
 * The 2 event keys that dual-write into IndexedVoterRegistration - see
 * indexedVoterRegistration.model.ts's header comment for the
 * out-of-order-write complication this handles.
 */
const VOTER_REGISTRATION_MIRROR_KEYS = new Set<string>([
  "VoterRegistry:VoterRegistered",
  "VoterRegistry:VoterRemoved",
]);

/**
 * The 4 role-event keys (Section 17 AuditLog work) - routed to
 * handleRoleAuditLogs INSTEAD of handleGenericLogs, not in addition to
 * it, since IndexedChainEventModel's schema requires electionId and
 * these events have none - see eventDefinitions.ts's roleGrantedEvent
 * comment.
 */
const AUDIT_ROLE_KEYS = new Set<string>([
  "Election:RoleGranted",
  "Election:RoleRevoked",
  "VoterRegistry:RoleGranted",
  "VoterRegistry:RoleRevoked",
]);

const workerLogger = logger.child({ service: "worker" });

async function getCheckpoint(eventKey: string): Promise<bigint> {
  const doc = await WorkerCheckpointModel.findOne({ eventKey });
  return doc ? doc.lastProcessedBlock : env.WORKER_START_BLOCK;
}

async function saveCheckpoint(eventKey: string, lastProcessedBlock: bigint): Promise<void> {
  await WorkerCheckpointModel.findOneAndUpdate(
    { eventKey },
    { eventKey, lastProcessedBlock },
    { upsert: true },
  );
}

/** Caches one getBlock() call per unique block number within a single sync pass, rather than one per log. */
class BlockTimestampCache {
  private cache = new Map<bigint, Date>();
  constructor(private client: PublicClient) {}

  async get(blockNumber: bigint): Promise<Date> {
    const cached = this.cache.get(blockNumber);
    if (cached) return cached;
    const block = await this.client.getBlock({ blockNumber });
    const timestamp = new Date(Number(block.timestamp) * 1000);
    this.cache.set(blockNumber, timestamp);
    return timestamp;
  }
}

/**
 * JSON/Mongo-safe conversion of decoded event args: bigints (viem decodes
 * every uint256/uint64 as bigint) are stringified, since neither
 * Mongoose's Mixed type nor a later JSON.stringify in an API response can
 * round-trip a raw bigint.
 */
function serializeArgs(args: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = typeof value === "bigint" ? value.toString() : String(value);
  }
  return result;
}

async function handleVoteCastLogs(logs: Log[], timestamps: BlockTimestampCache): Promise<void> {
  const typedLogs = logs as VoteCastLog[];
  for (const log of typedLogs) {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
      // Pending (not-yet-mined) logs are never returned by a getLogs call
      // scoped to fromBlock/toBlock, but the type allows for it - skip
      // defensively rather than persist a document with null identity
      // fields that would violate the idempotency unique index.
      continue;
    }
    const timestamp = await timestamps.get(log.blockNumber);
    await IndexedVoteEventModel.findOneAndUpdate(
      { txHash: log.transactionHash, logIndex: log.logIndex },
      {
        electionId: Number(log.args.electionId),
        voterAddress: log.args.voter,
        candidateId: Number(log.args.candidateId),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        timestamp,
      },
      { upsert: true },
    );
    await enqueueRollupRecompute(Number(log.args.electionId));
  }
}

async function handleGenericLogs(
  logs: Log[],
  def: EventSyncDefinition,
  timestamps: BlockTimestampCache,
): Promise<void> {
  for (const log of logs) {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
      continue;
    }
    // Untyped here (unlike VoteCast) since this path is deliberately
    // generic across 5 different event shapes - see this module's header
    // comment on why VoteCast alone gets a dedicated, precisely-typed
    // handler.
    const args = (log as unknown as { args: Record<string, unknown> }).args;
    const timestamp = await timestamps.get(log.blockNumber);
    await IndexedChainEventModel.findOneAndUpdate(
      { txHash: log.transactionHash, logIndex: log.logIndex },
      {
        eventName: def.eventName,
        contractName: def.contractName,
        electionId: Number(args.electionId),
        args: serializeArgs(args),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        timestamp,
      },
      { upsert: true },
    );
  }
}

/**
 * Dual-write path (approved fork - see indexedElection.model.ts's header
 * comment): ElectionCreated/CandidateAdded/ElectionFinalized ALSO get
 * written into IndexedElection, a purpose-built per-election mirror, in
 * ADDITION to their existing generic IndexedChainEvent write from
 * handleGenericLogs above (called separately, unconditionally, by
 * syncEvent) - not instead of it.
 *
 * One upsert per log, keyed on electionId (not txHash/logIndex - this
 * collection aggregates many events into one document per election, so
 * the per-event idempotency key doesn't apply here the way it does for
 * IndexedVoteEvent/IndexedChainEvent). See each branch below for how
 * idempotency is instead achieved per field.
 */
async function handleElectionMirrorLogs(
  logs: Log[],
  def: EventSyncDefinition,
  timestamps: BlockTimestampCache,
): Promise<void> {
  for (const log of logs) {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
      continue;
    }

    if (def.eventName === "ElectionCreated") {
      const typedLog = log as ElectionCreatedLog;
      const electionId = Number(typedLog.args.electionId);
      // $set (not $setOnInsert) is correct and safe here even though
      // ElectionCreated only ever fires once for a given electionId: it
      // also needs to fill these fields in on a document that may
      // already exist from an earlier-processed CandidateAdded (see
      // this module's header comment on out-of-order processing), not
      // only create a brand new one.
      await IndexedElectionModel.findOneAndUpdate(
        { electionId },
        {
          $set: {
            electionId,
            title: typedLog.args.title,
            startTime: typedLog.args.startTime,
            endTime: typedLog.args.endTime,
            creator: typedLog.args.creator,
          },
          $setOnInsert: { finalized: false, candidateIds: [] },
        },
        { upsert: true },
      );
      // Section 17 audit entry: election state transition.
      await recordAuditLog({
        category: "ELECTION_CREATED",
        source: "on-chain",
        actor: typedLog.args.creator ?? "",
        electionId,
        contractName: "Election",
        metadata: { title: typedLog.args.title ?? "" },
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        occurredAt: await timestamps.get(log.blockNumber),
      });
    } else if (def.eventName === "CandidateAdded") {
      const typedLog = log as CandidateAddedLog;
      const electionId = Number(typedLog.args.electionId);
      const candidateId = Number(typedLog.args.candidateId);
      // $addToSet is idempotent by itself for a redelivered log (adding
      // the same candidateId twice is a no-op) - this is what makes this
      // field safe under at-least-once delivery without a txHash/
      // logIndex idempotency key.
      await IndexedElectionModel.findOneAndUpdate(
        { electionId },
        {
          $addToSet: { candidateIds: candidateId },
          $setOnInsert: { electionId, finalized: false },
        },
        { upsert: true },
      );
      // Third destination for this event (decision (a) continuation,
      // Candidate module migration - see indexedCandidate.model.ts's
      // header comment). A plain upsert is sufficient here, unlike
      // IndexedVoterRegistration's conditional write, because
      // CandidateAdded is the ONLY event type that ever touches this
      // data - there's no "which of two independent streams is newer"
      // question to resolve.
      if (typedLog.args.name !== undefined && typedLog.args.metadataURI !== undefined) {
        await IndexedCandidateModel.findOneAndUpdate(
          { electionId, candidateId },
          { $set: { electionId, candidateId, name: typedLog.args.name, metadataURI: typedLog.args.metadataURI } },
          { upsert: true },
        );
      }
    } else if (def.eventName === "ElectionFinalized") {
      const typedLog = log as ElectionFinalizedLog;
      const electionId = Number(typedLog.args.electionId);
      await IndexedElectionModel.findOneAndUpdate(
        { electionId },
        {
          $set: { finalized: true, finalizedBy: typedLog.args.finalizedBy },
          $setOnInsert: { electionId, candidateIds: [] },
        },
        { upsert: true },
      );
      await enqueueRollupRecompute(electionId);
      const mirror = await IndexedElectionModel.findOne({ electionId }).lean();
      const title = mirror?.title ?? `Election #${electionId}`;
      await enqueueElectionFinalizedNotifications(electionId, title);
      // Section 17 audit entry: election state transition.
      await recordAuditLog({
        category: "ELECTION_FINALIZED",
        source: "on-chain",
        actor: typedLog.args.finalizedBy ?? "",
        electionId,
        contractName: "Election",
        metadata: { title },
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        occurredAt: await timestamps.get(log.blockNumber),
      });
    }
  }
}

/**
 * Applies one VoterRegistered/VoterRemoved event to the mirror,
 * correctly under out-of-order delivery relative to the OTHER event type
 * (see indexedVoterRegistration.model.ts's header comment for why this
 * is necessary here but wasn't for IndexedElection).
 *
 * Two-step, not a single upsert: a single `upsert:true` combined with an
 * ordering `$or` condition in the filter is unsafe - if an existing
 * document doesn't match the ordering condition (i.e. it already holds a
 * newer-or-equal event), MongoDB would still attempt to INSERT a new
 * document from the equality-only parts of the filter, which would
 * throw a duplicate-key error against this collection's unique
 * (electionId, voterAddress) index instead of safely no-op'ing.
 */
async function applyVoterRegistrationEvent(params: {
  electionId: number;
  voterAddress: string;
  registered: boolean;
  blockNumber: bigint;
  logIndex: number;
}): Promise<void> {
  const { electionId, blockNumber, logIndex, registered } = params;
  const voterAddress = params.voterAddress.toLowerCase();

  // Step 1: apply ONLY if this event is chronologically newer (by block,
  // then log index within a block) than whatever is currently stored.
  // No-op if a newer-or-equal event is already stored, or if no document
  // exists yet (matchedCount: 0 either way).
  const updateResult = await IndexedVoterRegistrationModel.updateOne(
    {
      electionId,
      voterAddress,
      $or: [
        { lastEventBlockNumber: { $lt: blockNumber } },
        { lastEventBlockNumber: blockNumber, lastEventLogIndex: { $lt: logIndex } },
      ],
    },
    { $set: { registered, lastEventBlockNumber: blockNumber, lastEventLogIndex: logIndex } },
  );
  if (updateResult.matchedCount > 0) return;

  // Step 2: nothing matched the ordering condition above. Either no
  // document exists yet (this insert-only upsert creates it correctly
  // via $setOnInsert), or one does and this event is stale/older (the
  // filter below matches that existing document exactly, so upsert
  // finds a match and does not insert a duplicate - $setOnInsert simply
  // never fires, safely no-op'ing the stale write).
  await IndexedVoterRegistrationModel.findOneAndUpdate(
    { electionId, voterAddress },
    {
      $setOnInsert: { electionId, voterAddress, registered, lastEventBlockNumber: blockNumber, lastEventLogIndex: logIndex },
    },
    { upsert: true },
  );
}

/**
 * Dual-write path (approved fork - see indexedVoterRegistration.model.ts's
 * header comment): VoterRegistered/VoterRemoved ALSO get written into
 * IndexedVoterRegistration, in ADDITION to their existing generic
 * IndexedChainEvent write from handleGenericLogs above - not instead of
 * it.
 */
async function handleVoterRegistrationMirrorLogs(logs: Log[], def: EventSyncDefinition): Promise<void> {
  for (const log of logs) {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
      continue;
    }

    if (def.eventName === "VoterRegistered") {
      const typedLog = log as VoterRegisteredLog;
      // viem's Log<> type marks indexed args as possibly undefined even
      // though a real decoded log always has them - defensive skip
      // rather than a forced cast, consistent with this file's other
      // null-guards above.
      if (typedLog.args.voter === undefined) continue;
      await applyVoterRegistrationEvent({
        electionId: Number(typedLog.args.electionId),
        voterAddress: typedLog.args.voter,
        registered: true,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    } else if (def.eventName === "VoterRemoved") {
      const typedLog = log as VoterRemovedLog;
      if (typedLog.args.voter === undefined) continue;
      await applyVoterRegistrationEvent({
        electionId: Number(typedLog.args.electionId),
        voterAddress: typedLog.args.voter,
        registered: false,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }
  }
}

/**
 * Handles the 4 role-event definitions (Section 17 AuditLog work) -
 * writes directly to AuditLogModel via recordAuditLog, nowhere else.
 * Unlike every other handler in this file, this is the SOLE persistence
 * path for these logs (see AUDIT_ROLE_KEYS's comment on why they don't
 * also go through handleGenericLogs).
 */
async function handleRoleAuditLogs(
  logs: Log[],
  def: EventSyncDefinition,
  timestamps: BlockTimestampCache,
): Promise<void> {
  for (const log of logs) {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
      continue;
    }
    if (def.eventName === "RoleGranted") {
      const typedLog = log as RoleGrantedLog;
      if (typedLog.args.account === undefined || typedLog.args.role === undefined) continue;
      await recordAuditLog({
        category: "ROLE_GRANTED",
        source: "on-chain",
        actor: typedLog.args.sender ?? "",
        subject: typedLog.args.account,
        contractName: def.contractName,
        role: roleNameFromHash(typedLog.args.role),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        occurredAt: await timestamps.get(log.blockNumber),
      });
    } else if (def.eventName === "RoleRevoked") {
      const typedLog = log as RoleRevokedLog;
      if (typedLog.args.account === undefined || typedLog.args.role === undefined) continue;
      await recordAuditLog({
        category: "ROLE_REVOKED",
        source: "on-chain",
        actor: typedLog.args.sender ?? "",
        subject: typedLog.args.account,
        contractName: def.contractName,
        role: roleNameFromHash(typedLog.args.role),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        occurredAt: await timestamps.get(log.blockNumber),
      });
    }
  }
}

/**
 * Syncs a single event definition: fetch new logs since its checkpoint,
 * persist them idempotently, then advance its checkpoint. Checkpoint is
 * only advanced AFTER a successful persist of every log in this batch -
 * if persistence throws partway through, the checkpoint stays put and
 * the next poll retries the same range (safe, per getNewLogs's
 * at-least-once contract).
 */
export async function syncEvent(def: EventSyncDefinition, client?: PublicClient): Promise<{ processed: number }> {
  const resolvedClient = client ?? getPublicClient();
  const lastProcessedBlock = await getCheckpoint(def.key);

  const { logs, newCheckpoint } = await getNewLogs({
    address: def.address,
    event: def.event,
    checkpoint: { lastProcessedBlock },
    client: resolvedClient,
  });

  const timestamps = new BlockTimestampCache(resolvedClient);

  if (def.key === "Election:VoteCast") {
    await handleVoteCastLogs(logs, timestamps);
  } else if (AUDIT_ROLE_KEYS.has(def.key)) {
    // Sole persistence path for role events - deliberately skips
    // handleGenericLogs (see AUDIT_ROLE_KEYS's comment).
    await handleRoleAuditLogs(logs, def, timestamps);
  } else {
    await handleGenericLogs(logs, def, timestamps);
    if (ELECTION_MIRROR_KEYS.has(def.key)) {
      await handleElectionMirrorLogs(logs, def, timestamps);
    }
    if (VOTER_REGISTRATION_MIRROR_KEYS.has(def.key)) {
      await handleVoterRegistrationMirrorLogs(logs, def);
    }
  }

  await saveCheckpoint(def.key, newCheckpoint.lastProcessedBlock);

  return { processed: logs.length };
}

/**
 * Syncs all 10 events (EVENT_SYNC_DEFINITIONS) for one poll cycle. Each
 * event's failure is caught and logged independently - one event type
 * erroring must not prevent the others from making progress in the same
 * cycle (that event's own checkpoint simply won't advance, so it retries
 * the same range next poll).
 */
export async function syncAllEvents(client?: PublicClient): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  for (const def of EVENT_SYNC_DEFINITIONS) {
    try {
      const { processed } = await syncEvent(def, client);
      results[def.key] = processed;
      if (processed > 0) {
        workerLogger.info({ eventKey: def.key, processed }, "Synced new events");
      }
    } catch (err) {
      workerLogger.error({ err, eventKey: def.key }, "Failed to sync event - checkpoint not advanced, will retry next poll");
      results[def.key] = 0;
    }
  }
  return results;
}