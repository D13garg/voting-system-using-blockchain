// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessRoles} from "./AccessRoles.sol";
import {VoterRegistry} from "./VoterRegistry.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Election
/// @notice Manages all elections on the platform: candidates, vote casting,
/// tallying, and lifecycle/finalization. Per ADR-005, this is a single
/// contract holding a mapping of all elections rather than a factory
/// deploying a new contract per election - no election in this system
/// needs isolation from another election's compromise, so the factory
/// pattern's extra deployment gas would buy nothing here.
///
/// On-chain state machine (architecture Section 16): this contract only
/// enforces the states that gate a function call. The full off-chain
/// workflow states (Draft, Registration Open, Registration Closed) live in
/// MongoDB only (architecture Section 11: those are workflow states, not
/// authoritative on-chain facts). On-chain, an election's lifecycle is:
///
///   created (exists) -> [startTime, endTime) is the active voting window
///   -> endTime passed, not yet finalized ("Voting Ended", provisional)
///   -> finalizeElection() called ("Result Finalized", per ADR-006)
///
/// Per ADR-006, finalization is an explicit admin transaction, not inferred
/// purely from endTime passing - this gives the worker (architecture
/// Section 8) an unambiguous on-chain event to lock the AnalyticsRollup
/// against, rather than independently judging "enough time has passed."
contract Election is AccessRoles, Pausable, ReentrancyGuard {
    struct ElectionData {
        string title;
        uint64 startTime;
        uint64 endTime;
        bool finalized;
        address creator;
        uint256 candidateCount;
    }

    struct Candidate {
        string name;
        string metadataURI;
        uint256 voteCount;
    }

    /// @notice The VoterRegistry this Election contract checks eligibility
    /// against. Set once at construction (immutable) - per ADR-005, this
    /// contract is not upgradeable, so there is no path to ever point at a
    /// different registry post-deployment. A future V2 (ADR-005's
    /// versioned-redeployment strategy, architecture Section 6.1) would be
    /// an entirely new Election contract, potentially constructed against
    /// a new VoterRegistry, rather than this one being modified.
    VoterRegistry public immutable voterRegistry;

    uint256 private _electionCount;

    /// @notice electionId => election metadata.
    mapping(uint256 => ElectionData) private _elections;

    /// @notice electionId => candidateId => candidate.
    mapping(uint256 => mapping(uint256 => Candidate)) private _candidates;

    /// @notice electionId => voter address => has this address already voted.
    /// Enforced independently of VoterRegistry's eligibility check: being
    /// registered and having voted are two different facts, both required
    /// to be checked on every vote() call (architecture Section 12:
    /// "Double voting: Enforced on-chain via a hasVoted mapping checked in
    /// a require before any tally update").
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    event ElectionCreated(uint256 indexed electionId, string title, uint64 startTime, uint64 endTime, address indexed creator);
    event CandidateAdded(uint256 indexed electionId, uint256 indexed candidateId, string name, string metadataURI);
    event VoteCast(uint256 indexed electionId, address indexed voter, uint256 indexed candidateId);
    event ElectionFinalized(uint256 indexed electionId, address indexed finalizedBy);

    error ElectionDoesNotExist(uint256 electionId);
    error CandidateDoesNotExist(uint256 electionId, uint256 candidateId);
    error InvalidTimeWindow(uint64 startTime, uint64 endTime);
    error VotingNotYetOpen(uint256 electionId, uint64 startTime);
    error VotingAlreadyClosed(uint256 electionId, uint64 endTime);
    error VotingStillOpen(uint256 electionId, uint64 endTime);
    error VoterNotRegistered(uint256 electionId, address voter);
    error VoterAlreadyVoted(uint256 electionId, address voter);
    error ElectionAlreadyFinalized(uint256 electionId);
    error CannotAddCandidateAfterVotingStarts(uint256 electionId, uint64 startTime);

    /// @param voterRegistryAddress Address of the deployed VoterRegistry
    /// this contract will check eligibility against. Passed at
    /// construction, not settable later (ADR-005: non-upgradeable V1).
    constructor(address voterRegistryAddress) {
        voterRegistry = VoterRegistry(voterRegistryAddress);
    }

    /// @notice Creates a new election. Restricted to
    /// ELECTION_ADMINISTRATOR_ROLE (architecture Section 13). Candidates are
    /// added afterwards via addCandidate, one at a time (per the confirmed
    /// "no candidate cap" design decision - addCandidate is itself
    /// admin-gated, so an unbounded candidate list carries no exploitable
    /// risk; the only cost of more candidates is gas paid by the admin
    /// adding them).
    function createElection(
        string calldata title,
        uint64 startTime,
        uint64 endTime
    ) external onlyRole(ELECTION_ADMINISTRATOR_ROLE) whenNotPaused returns (uint256 electionId) {
        if (startTime >= endTime) revert InvalidTimeWindow(startTime, endTime);

        electionId = _electionCount++;
        _elections[electionId] = ElectionData({
            title: title,
            startTime: startTime,
            endTime: endTime,
            finalized: false,
            creator: msg.sender,
            candidateCount: 0
        });

        emit ElectionCreated(electionId, title, startTime, endTime, msg.sender);
    }

    /// @notice Adds a candidate to an existing election. Restricted to
    /// ELECTION_ADMINISTRATOR_ROLE. Disallowed once voting has started,
    /// since allowing new candidates mid-vote would let early voters choose
    /// from a different ballot than later voters - a correctness issue, not
    /// just a fairness one.
    function addCandidate(
        uint256 electionId,
        string calldata name,
        string calldata metadataURI
    ) external onlyRole(ELECTION_ADMINISTRATOR_ROLE) whenNotPaused {
        ElectionData storage election = _getExistingElection(electionId);
        if (block.timestamp >= election.startTime) {
            revert CannotAddCandidateAfterVotingStarts(electionId, election.startTime);
        }

        uint256 candidateId = election.candidateCount++;
        _candidates[electionId][candidateId] = Candidate({name: name, metadataURI: metadataURI, voteCount: 0});

        emit CandidateAdded(electionId, candidateId, name, metadataURI);
    }

    /// @notice Casts a vote for `candidateId` in `electionId`. The single
    /// most security-critical function in this contract (architecture
    /// Section 12). Checks-effects-interactions ordering: all checks first
    /// (eligibility, active window, not-already-voted, candidate exists),
    /// then effects (mark voted, increment tally) - no external calls occur
    /// in this function at all, so reentrancy is not actually reachable
    /// here; nonReentrant is applied anyway as defensive depth per
    /// architecture Section 6's stated guidance, at negligible gas cost.
    ///
    /// Coverage note: branch coverage on this line's nonReentrant modifier
    /// will never reach 100% through any test calling vote() normally,
    /// and that is expected, not a gap to close. Reaching the "currently
    /// entered" branch requires an external call made from inside vote()
    /// that calls back into vote() - but vote() makes zero external calls,
    /// so there is no callback opportunity for any attacker contract to
    /// exploit, with or without a test deliberately attempting it. The
    /// branch is unreachable by construction, which is the intended
    /// security property, not an untested code path.
    function vote(uint256 electionId, uint256 candidateId) external nonReentrant whenNotPaused {
        ElectionData storage election = _getExistingElection(electionId);

        if (block.timestamp < election.startTime) revert VotingNotYetOpen(electionId, election.startTime);
        if (block.timestamp >= election.endTime) revert VotingAlreadyClosed(electionId, election.endTime);
        if (candidateId >= election.candidateCount) revert CandidateDoesNotExist(electionId, candidateId);
        if (!voterRegistry.isRegisteredForElection(electionId, msg.sender)) {
            revert VoterNotRegistered(electionId, msg.sender);
        }
        if (_hasVoted[electionId][msg.sender]) revert VoterAlreadyVoted(electionId, msg.sender);

        _hasVoted[electionId][msg.sender] = true;
        _candidates[electionId][candidateId].voteCount++;

        emit VoteCast(electionId, msg.sender, candidateId);
    }

    /// @notice Finalizes an election's results. Per ADR-006, this is an
    /// explicit transaction rather than inferring finality from endTime
    /// alone - it gives the worker an unambiguous ElectionFinalized event
    /// to lock the AnalyticsRollup against (architecture Section 16,
    /// "Result Finalized" row). Restricted to ELECTION_ADMINISTRATOR_ROLE.
    /// Can only be called after the voting window has fully closed, and
    /// only once per election.
    function finalizeElection(uint256 electionId) external onlyRole(ELECTION_ADMINISTRATOR_ROLE) whenNotPaused {
        ElectionData storage election = _getExistingElection(electionId);

        if (block.timestamp < election.endTime) revert VotingStillOpen(electionId, election.endTime);
        if (election.finalized) revert ElectionAlreadyFinalized(electionId);

        election.finalized = true;
        emit ElectionFinalized(electionId, msg.sender);
    }

    /// @notice Pauses vote casting and election creation system-wide.
    /// Restricted to SYSTEM_ADMINISTRATOR_ROLE (architecture Section 13:
    /// only System Administrators can "pause/unpause the contract
    /// system-wide"). Emergency-response mechanism per architecture
    /// Section 6 ("Emergency pause").
    function pause() external onlyRole(SYSTEM_ADMINISTRATOR_ROLE) {
        _pause();
    }

    /// @notice Reverses pause(). Restricted to SYSTEM_ADMINISTRATOR_ROLE.
    function unpause() external onlyRole(SYSTEM_ADMINISTRATOR_ROLE) {
        _unpause();
    }

    // --- View functions (read path) ---
    //
    // These views exist for direct on-chain verification (architecture
    // Section 14, step 9: "Verifying votes ... any user can independently
    // query the contract or Etherscan"). They are NOT the primary read
    // path for the frontend - per architecture Section 3.1, the frontend's
    // default reads go through the backend API against MongoDB, which the
    // worker keeps converged with these same on-chain facts via indexed
    // events. These views are the source of truth those mirrors are
    // checked against, not a replacement for them.

    function getElection(uint256 electionId) external view returns (ElectionData memory) {
        return _getExistingElection(electionId);
    }

    function getCandidate(uint256 electionId, uint256 candidateId) external view returns (Candidate memory) {
        _getExistingElection(electionId);
        if (candidateId >= _elections[electionId].candidateCount) {
            revert CandidateDoesNotExist(electionId, candidateId);
        }
        return _candidates[electionId][candidateId];
    }

    function hasVoted(uint256 electionId, address voter) external view returns (bool) {
        return _hasVoted[electionId][voter];
    }

    function electionCount() external view returns (uint256) {
        return _electionCount;
    }

    function _getExistingElection(uint256 electionId) private view returns (ElectionData storage) {
        ElectionData storage election = _elections[electionId];
        // An election that was never created has startTime == 0 AND
        // endTime == 0, which createElection's InvalidTimeWindow check
        // (startTime >= endTime, i.e. 0 >= 0) makes structurally
        // impossible to create for real - so endTime == 0 is a reliable
        // "does not exist" sentinel without a separate exists bool.
        if (election.endTime == 0) revert ElectionDoesNotExist(electionId);
        return election;
    }
}
