// The 10 on-chain events this worker indexes (6 original domain events +
// 4 AccessControl role events added for Section 17's AuditLog work - see
// roleGrantedEvent's comment below), and the metadata eventSync.ts
// needs to poll and persist each one. Event signatures are copied
// verbatim from contracts/contracts/Election.sol and VoterRegistry.sol
// (not re-derived from the extracted ABI JSON, unlike
// ElectionContractClient.ts's function calls) - parseAbiItem needs a
// single literal event signature to produce a properly-typed AbiEvent,
// which is what lets eventSync.ts access `log.args.electionId` etc. with
// real type-checking instead of `unknown`, at the small cost of this
// file needing to stay in sync with the .sol source by hand if an event
// signature ever changes.

import { parseAbiItem, keccak256, toBytes, type AbiEvent } from "viem";
import { env } from "../../config/env.js";

export const electionCreatedEvent = parseAbiItem(
  "event ElectionCreated(uint256 indexed electionId, string title, uint64 startTime, uint64 endTime, address indexed creator)",
);
export const candidateAddedEvent = parseAbiItem(
  "event CandidateAdded(uint256 indexed electionId, uint256 indexed candidateId, string name, string metadataURI)",
);
export const voteCastEvent = parseAbiItem(
  "event VoteCast(uint256 indexed electionId, address indexed voter, uint256 indexed candidateId)",
);
export const electionFinalizedEvent = parseAbiItem(
  "event ElectionFinalized(uint256 indexed electionId, address indexed finalizedBy)",
);
export const voterRegisteredEvent = parseAbiItem(
  "event VoterRegistered(uint256 indexed electionId, address indexed voter, address indexed registeredBy)",
);
export const voterRemovedEvent = parseAbiItem(
  "event VoterRemoved(uint256 indexed electionId, address indexed voter, address indexed removedBy)",
);

// OpenZeppelin AccessControl's two standard events (inherited by both
// contracts via AccessRoles.sol - see that file's header comment). Not
// domain events, so they carry no electionId - this is why they're
// routed through their own dedicated audit-only handler in eventSync.ts
// rather than through handleGenericLogs/IndexedChainEventModel (whose
// schema requires electionId). Section 17's "role grants/revocations"
// audit-log category exists specifically because nothing else in this
// codebase previously listened for these two events at all.
export const roleGrantedEvent = parseAbiItem(
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
);
export const roleRevokedEvent = parseAbiItem(
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
);

/**
 * AccessControl roles are keccak256(name) bytes32 hashes on-chain, not
 * strings - this lookup makes AuditLog entries human-readable. Computed
 * from the literal role names in contracts/contracts/AccessRoles.sol
 * (must stay in sync with that file by hand, same convention as this
 * file's event signatures above). DEFAULT_ADMIN_ROLE is OpenZeppelin's
 * own constant (bytes32(0)), granted once to the deployer in
 * AccessRoles's constructor alongside the other two.
 */
const DEFAULT_ADMIN_ROLE_HASH = `0x${"0".repeat(64)}`;
export const ROLE_NAME_BY_HASH: Record<string, string> = {
  [DEFAULT_ADMIN_ROLE_HASH]: "DEFAULT_ADMIN_ROLE",
  [keccak256(toBytes("ELECTION_ADMINISTRATOR_ROLE")).toLowerCase()]: "ELECTION_ADMINISTRATOR_ROLE",
  [keccak256(toBytes("SYSTEM_ADMINISTRATOR_ROLE")).toLowerCase()]: "SYSTEM_ADMINISTRATOR_ROLE",
};

export function roleNameFromHash(hash: string): string {
  return ROLE_NAME_BY_HASH[hash.toLowerCase()] ?? hash;
}

export interface EventSyncDefinition {
  /** Checkpoint key, e.g. "Election:VoteCast" - also doubles as a stable log-correlation tag. */
  key: string;
  contractName: "Election" | "VoterRegistry";
  eventName: string;
  address: `0x${string}`;
  event: AbiEvent;
}

/**
 * All 6 events, per the approved Phase 6 scope decision ("wire up all 6
 * events in one pass"). VoteCast is handled specially in eventSync.ts
 * (written to the dedicated IndexedVoteEventModel, and ONLY there); all
 * 5 others go through the generic IndexedChainEventModel path as before
 * - see that model's header comment for why. Additionally,
 * ElectionCreated/CandidateAdded/ElectionFinalized ALSO dual-write into
 * IndexedElectionModel (decision (a) continuation, Election module
 * migration) - see indexedElection.model.ts's header comment for the
 * dual-write-not-replace rationale. VoterRegistered/VoterRemoved remain
 * generic-only for now.
 */
export const EVENT_SYNC_DEFINITIONS: EventSyncDefinition[] = [
  {
    key: "Election:ElectionCreated",
    contractName: "Election",
    eventName: "ElectionCreated",
    address: env.CONTRACT_ADDRESS_ELECTION as `0x${string}`,
    event: electionCreatedEvent,
  },
  {
    key: "Election:CandidateAdded",
    contractName: "Election",
    eventName: "CandidateAdded",
    address: env.CONTRACT_ADDRESS_ELECTION as `0x${string}`,
    event: candidateAddedEvent,
  },
  {
    key: "Election:VoteCast",
    contractName: "Election",
    eventName: "VoteCast",
    address: env.CONTRACT_ADDRESS_ELECTION as `0x${string}`,
    event: voteCastEvent,
  },
  {
    key: "Election:ElectionFinalized",
    contractName: "Election",
    eventName: "ElectionFinalized",
    address: env.CONTRACT_ADDRESS_ELECTION as `0x${string}`,
    event: electionFinalizedEvent,
  },
  {
    key: "VoterRegistry:VoterRegistered",
    contractName: "VoterRegistry",
    eventName: "VoterRegistered",
    address: env.CONTRACT_ADDRESS_VOTER_REGISTRY as `0x${string}`,
    event: voterRegisteredEvent,
  },
  {
    key: "VoterRegistry:VoterRemoved",
    contractName: "VoterRegistry",
    eventName: "VoterRemoved",
    address: env.CONTRACT_ADDRESS_VOTER_REGISTRY as `0x${string}`,
    event: voterRemovedEvent,
  },
  // 4 new audit-only definitions (Section 17 AuditLog work): AccessControl
  // role events, both contracts. Deliberately NOT added to
  // ELECTION_MIRROR_KEYS/VOTER_REGISTRATION_MIRROR_KEYS or routed through
  // handleGenericLogs - see this file's roleGrantedEvent comment above,
  // and AUDIT_ROLE_KEYS in eventSync.ts for the dedicated handler.
  {
    key: "Election:RoleGranted",
    contractName: "Election",
    eventName: "RoleGranted",
    address: env.CONTRACT_ADDRESS_ELECTION as `0x${string}`,
    event: roleGrantedEvent,
  },
  {
    key: "Election:RoleRevoked",
    contractName: "Election",
    eventName: "RoleRevoked",
    address: env.CONTRACT_ADDRESS_ELECTION as `0x${string}`,
    event: roleRevokedEvent,
  },
  {
    key: "VoterRegistry:RoleGranted",
    contractName: "VoterRegistry",
    eventName: "RoleGranted",
    address: env.CONTRACT_ADDRESS_VOTER_REGISTRY as `0x${string}`,
    event: roleGrantedEvent,
  },
  {
    key: "VoterRegistry:RoleRevoked",
    contractName: "VoterRegistry",
    eventName: "RoleRevoked",
    address: env.CONTRACT_ADDRESS_VOTER_REGISTRY as `0x${string}`,
    event: roleRevokedEvent,
  },
];