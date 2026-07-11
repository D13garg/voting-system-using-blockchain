// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessRoles} from "./AccessRoles.sol";

/// @title VoterRegistry
/// @notice Tracks which addresses are eligible to vote, per election.
/// Per ADR-005 / architecture Section 5 ("Should users register on-chain or
/// off-chain?"), eligibility itself is on-chain and authoritative; the
/// *workflow* of requesting and reviewing registration happens off-chain
/// (backend Admin module), with only the final approval written here as a
/// transaction.
///
/// Per the confirmed design decision (per-election eligibility, not a
/// single global registry): registering a voter for election A does NOT
/// make them eligible for election B. Each election's admin must
/// explicitly register each voter for that specific election. This matches
/// the architecture's own specification (Section 6: "optionally
/// mapping(uint256 => mapping(address => bool)) isRegisteredForElection")
/// and a real-world voting platform's access model, where eligibility for
/// one election says nothing about eligibility for an unrelated one.
contract VoterRegistry is AccessRoles {
    /// @notice electionId => voter address => eligible to vote in that election.
    mapping(uint256 => mapping(address => bool)) private _isRegisteredForElection;

    /// @notice Emitted when a voter is registered for a specific election.
    /// Consumed by the backend worker (architecture Section 8) to update
    /// MongoDB's RegistrationRequest status from "pending" to "approved"
    /// and unlock the voter's dashboard state (architecture Section 14,
    /// step 5: "Voter sees eligibility update").
    event VoterRegistered(uint256 indexed electionId, address indexed voter, address indexed registeredBy);

    /// @notice Emitted when a voter's eligibility for an election is revoked.
    /// Not used by the core v1 flow (no "unregister" UI action is specified
    /// in the architecture), but included because the architecture's
    /// VoterRegistry design explicitly lists VoterRemoved as an event
    /// (Section 6), and an emergency-correction path (e.g., a registration
    /// approved in error) should exist without requiring a contract redeploy.
    event VoterRemoved(uint256 indexed electionId, address indexed voter, address indexed removedBy);

    error AlreadyRegistered(uint256 electionId, address voter);
    error NotCurrentlyRegistered(uint256 electionId, address voter);
    error ZeroAddressVoter();

    /// @notice Registers `voter` as eligible to vote in `electionId`.
    /// Restricted to ELECTION_ADMINISTRATOR_ROLE per architecture Section
    /// 13 (Election Administrators "approve/reject registration requests").
    /// @dev Idempotency: reverts on double-registration rather than
    /// silently succeeding, so the backend's approval-workflow logic (which
    /// expects a state transition pending -> approved) can rely on a
    /// successful transaction meaning the state actually changed.
    function registerVoter(uint256 electionId, address voter) external onlyRole(ELECTION_ADMINISTRATOR_ROLE) {
        if (voter == address(0)) revert ZeroAddressVoter();
        if (_isRegisteredForElection[electionId][voter]) revert AlreadyRegistered(electionId, voter);

        _isRegisteredForElection[electionId][voter] = true;
        emit VoterRegistered(electionId, voter, msg.sender);
    }

    /// @notice Revokes `voter`'s eligibility for `electionId`. See VoterRemoved
    /// event docs above for why this exists despite not being part of the
    /// primary v1 user journey.
    function removeVoter(uint256 electionId, address voter) external onlyRole(ELECTION_ADMINISTRATOR_ROLE) {
        if (!_isRegisteredForElection[electionId][voter]) revert NotCurrentlyRegistered(electionId, voter);

        _isRegisteredForElection[electionId][voter] = false;
        emit VoterRemoved(electionId, voter, msg.sender);
    }

    /// @notice Returns whether `voter` is currently eligible to vote in
    /// `electionId`. Called by Election.vote() (this is the cross-contract
    /// read described in the Phase 2 design: Election holds a reference to
    /// VoterRegistry and checks eligibility here rather than duplicating
    /// registry state inside Election itself).
    function isRegisteredForElection(uint256 electionId, address voter) external view returns (bool) {
        return _isRegisteredForElection[electionId][voter];
    }
}
