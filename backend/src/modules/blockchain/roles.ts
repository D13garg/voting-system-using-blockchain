// On-chain AccessControl role hash constants (AccessRoles.sol).
//
// These are keccak256(name) bytes32 hashes, not strings - see
// AccessRoles.sol's header comment for the role hierarchy this maps to
// (architecture Section 13). Computed the same way, from the same
// literal role names, as indexing/eventDefinitions.ts's ROLE_NAME_BY_HASH
// - that file needs the hash -> name direction (for AuditLog readability),
// this one needs the name -> hash direction (for hasRole() calls), so
// they're two small, independently-computed constants rather than one
// importing the other. Both must stay in sync with
// contracts/contracts/AccessRoles.sol by hand if a role name ever
// changes, same documented convention as eventDefinitions.ts.
//
// Added for the on-chain-role-enforcement gap (HANDOFF.md's "Newly
// discovered pre-frontend items", item 1) - see auth.roles.middleware.ts
// for where these are actually used.

import { keccak256, toBytes } from "viem";

export const ELECTION_ADMINISTRATOR_ROLE = keccak256(toBytes("ELECTION_ADMINISTRATOR_ROLE"));
export const SYSTEM_ADMINISTRATOR_ROLE = keccak256(toBytes("SYSTEM_ADMINISTRATOR_ROLE"));