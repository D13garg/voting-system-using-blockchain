// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AccessRoles
/// @notice Shared OpenZeppelin AccessControl role identifiers, inherited by
/// both VoterRegistry and Election so the two contracts always agree on
/// what a given role constant means. See ADR-005 for why AccessControl was
/// chosen over Ownable: the five-tier role hierarchy in the architecture
/// (Section 13) requires at least two distinct on-chain privilege levels,
/// which Ownable's single-owner model cannot express without reimplementing
/// AccessControl poorly.
///
/// Role hierarchy mapping (architecture Section 13 -> on-chain roles):
///   Guest / Wallet User / Verified Voter -> no on-chain role, gated by
///     VoterRegistry.isRegisteredForElection instead (a mapping check, not
///     a role grant - registering many thousands of voters as AccessControl
///     role-holders would be unnecessarily gas-expensive and is not what
///     AccessControl is for).
///   Election Administrator -> ELECTION_ADMINISTRATOR_ROLE
///   System Administrator   -> SYSTEM_ADMINISTRATOR_ROLE
abstract contract AccessRoles is AccessControl {
    /// @notice Can create elections, add candidates, register voters for an
    /// election, and finalize elections (architecture Section 13: Election
    /// Administrator). Cannot grant/revoke roles or pause the system.
    bytes32 public constant ELECTION_ADMINISTRATOR_ROLE = keccak256("ELECTION_ADMINISTRATOR_ROLE");

    /// @notice Superset of ELECTION_ADMINISTRATOR_ROLE's practical reach:
    /// can additionally grant/revoke any role and pause/unpause the system
    /// (architecture Section 13: System Administrator). Per Section 13's
    /// stated production guidance, this role's holder "should be a
    /// multisig wallet in any non-trivial deployment" - that is a
    /// deployment-time decision (which address receives the role), not
    /// something the contract itself can enforce.
    bytes32 public constant SYSTEM_ADMINISTRATOR_ROLE = keccak256("SYSTEM_ADMINISTRATOR_ROLE");

    /// @notice Grants the deploying address both administrative roles at
    /// construction time. A real deployment immediately transfers
    /// SYSTEM_ADMINISTRATOR_ROLE to a multisig and renounces it from the
    /// deployer (see scripts/deploy.ts) - granting it here first is what
    /// makes that handoff possible, since AccessControl requires the
    /// granting account to itself hold DEFAULT_ADMIN_ROLE or the specific
    /// role being granted.
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SYSTEM_ADMINISTRATOR_ROLE, msg.sender);
        _grantRole(ELECTION_ADMINISTRATOR_ROLE, msg.sender);
    }
}
