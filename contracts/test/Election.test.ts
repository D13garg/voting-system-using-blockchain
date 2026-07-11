import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import type { Election, VoterRegistry } from "../../shared/abi/typechain-types/index.js";

describe("Election", function () {
  const ONE_HOUR = 60 * 60;

  /**
   * Deploys VoterRegistry + Election, grants the electionAdmin role to a
   * dedicated signer (distinct from the deployer, mirroring a real
   * multi-admin deployment), and computes a startTime/endTime window
   * relative to the current chain time so tests aren't brittle against
   * wall-clock time.
   */
  async function deployFixture() {
    const [deployer, electionAdmin, systemAdmin, voterA, voterB, unregisteredVoter, stranger] =
      await ethers.getSigners();

    const VoterRegistryFactory = await ethers.getContractFactory("VoterRegistry");
    const registry = (await VoterRegistryFactory.deploy()) as unknown as VoterRegistry;
    await registry.waitForDeployment();

    const ElectionFactory = await ethers.getContractFactory("Election");
    const election = (await ElectionFactory.deploy(await registry.getAddress())) as unknown as Election;
    await election.waitForDeployment();

    const electionAdminRole = await election.ELECTION_ADMINISTRATOR_ROLE();
    const systemAdminRole = await election.SYSTEM_ADMINISTRATOR_ROLE();
    const registryAdminRole = await registry.ELECTION_ADMINISTRATOR_ROLE();

    await election.grantRole(electionAdminRole, electionAdmin.address);
    await election.grantRole(systemAdminRole, systemAdmin.address);
    // The registry and the election contract are deployed independently
    // (architecture Section 6: Election holds a reference to
    // VoterRegistry), so the electionAdmin signer must separately hold the
    // admin role on the registry too in order to call registerVoter there.
    await registry.grantRole(registryAdminRole, electionAdmin.address);

    const now = await time.latest();
    const startTime = now + ONE_HOUR;
    const endTime = startTime + ONE_HOUR;

    return {
      registry,
      election,
      deployer,
      electionAdmin,
      systemAdmin,
      voterA,
      voterB,
      unregisteredVoter,
      stranger,
      startTime,
      endTime,
    };
  }

  /** Creates an election with two candidates, ready for the voting window. */
  async function createElectionWithCandidates(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
  ): Promise<bigint> {
    const { election, electionAdmin, startTime, endTime } = fixture;

    const tx = await election
      .connect(electionAdmin)
      .createElection("Student Council President", startTime, endTime);
    const receipt = await tx.wait();
    const parsedLogs = receipt!.logs
      .map((log: { topics: ReadonlyArray<string>; data: string }) => {
        try {
          return election.interface.parseLog({ topics: log.topics as string[], data: log.data });
        } catch {
          return null;
        }
      })
      .filter((parsed: ReturnType<typeof election.interface.parseLog>): parsed is NonNullable<typeof parsed> => parsed !== null);
    const event = parsedLogs.find((parsed: NonNullable<ReturnType<typeof election.interface.parseLog>>) => parsed.name === "ElectionCreated");
    const electionId = event!.args[0] as bigint;

    await election.connect(electionAdmin).addCandidate(electionId, "Alice", "ipfs://alice");
    await election.connect(electionAdmin).addCandidate(electionId, "Bob", "ipfs://bob");

    return electionId;
  }

  describe("createElection", function () {
    it("allows ELECTION_ADMINISTRATOR_ROLE to create an election and emits ElectionCreated", async function () {
      const fixture = await deployFixture();
      const { election, electionAdmin, startTime, endTime } = fixture;

      await expect(election.connect(electionAdmin).createElection("Test Election", startTime, endTime))
        .to.emit(election, "ElectionCreated")
        .withArgs(0n, "Test Election", startTime, endTime, electionAdmin.address);
    });

    it("reverts when called by a non-admin", async function () {
      const { election, stranger, startTime, endTime } = await deployFixture();

      await expect(
        election.connect(stranger).createElection("Test Election", startTime, endTime),
      ).to.be.revertedWithCustomError(election, "AccessControlUnauthorizedAccount");
    });

    it("reverts when startTime >= endTime", async function () {
      const { election, electionAdmin, startTime } = await deployFixture();

      await expect(
        election.connect(electionAdmin).createElection("Bad Window", startTime, startTime),
      )
        .to.be.revertedWithCustomError(election, "InvalidTimeWindow")
        .withArgs(startTime, startTime);
    });

    it("reverts when the contract is paused", async function () {
      const { election, electionAdmin, systemAdmin, startTime, endTime } = await deployFixture();

      await election.connect(systemAdmin).pause();

      await expect(
        election.connect(electionAdmin).createElection("Test Election", startTime, endTime),
      ).to.be.revertedWithCustomError(election, "EnforcedPause");
    });

    it("increments electionCount and assigns sequential IDs", async function () {
      const { election, electionAdmin, startTime, endTime } = await deployFixture();

      await election.connect(electionAdmin).createElection("First", startTime, endTime);
      await election.connect(electionAdmin).createElection("Second", startTime, endTime);

      expect(await election.electionCount()).to.equal(2n);
    });
  });

  describe("addCandidate", function () {
    it("allows an admin to add a candidate before voting starts", async function () {
      const fixture = await deployFixture();
      const { election, electionAdmin, startTime, endTime } = fixture;

      await election.connect(electionAdmin).createElection("Test", startTime, endTime);

      await expect(election.connect(electionAdmin).addCandidate(0n, "Alice", "ipfs://alice"))
        .to.emit(election, "CandidateAdded")
        .withArgs(0n, 0n, "Alice", "ipfs://alice");
    });

    it("reverts when called by a non-admin", async function () {
      const { election, electionAdmin, stranger, startTime, endTime } = await deployFixture();

      await election.connect(electionAdmin).createElection("Test", startTime, endTime);

      await expect(
        election.connect(stranger).addCandidate(0n, "Alice", "ipfs://alice"),
      ).to.be.revertedWithCustomError(election, "AccessControlUnauthorizedAccount");
    });

    it("reverts when adding a candidate to a non-existent election", async function () {
      const { election, electionAdmin } = await deployFixture();

      await expect(election.connect(electionAdmin).addCandidate(999n, "Alice", "ipfs://alice"))
        .to.be.revertedWithCustomError(election, "ElectionDoesNotExist")
        .withArgs(999n);
    });

    it("reverts when adding a candidate after voting has started", async function () {
      const fixture = await deployFixture();
      const { election, electionAdmin, startTime, endTime } = fixture;

      await election.connect(electionAdmin).createElection("Test", startTime, endTime);
      await time.increaseTo(startTime);

      await expect(election.connect(electionAdmin).addCandidate(0n, "Late Candidate", "ipfs://late"))
        .to.be.revertedWithCustomError(election, "CannotAddCandidateAfterVotingStarts")
        .withArgs(0n, startTime);
    });

    it("reverts when the contract is paused (closes a coverage gap: addCandidate's own whenNotPaused branch was previously untested even though createElection's and vote's were)", async function () {
      const { election, electionAdmin, systemAdmin, startTime, endTime } = await deployFixture();

      await election.connect(electionAdmin).createElection("Test", startTime, endTime);
      await election.connect(systemAdmin).pause();

      await expect(
        election.connect(electionAdmin).addCandidate(0n, "Alice", "ipfs://alice"),
      ).to.be.revertedWithCustomError(election, "EnforcedPause");
    });
  });

  describe("vote", function () {
    it("allows a registered voter to cast a vote during the active window", async function () {
      const fixture = await deployFixture();
      const { election, registry, electionAdmin, voterA, startTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await registry.connect(electionAdmin).registerVoter(electionId, voterA.address);
      await time.increaseTo(startTime + 1);

      await expect(election.connect(voterA).vote(electionId, 0n))
        .to.emit(election, "VoteCast")
        .withArgs(electionId, voterA.address, 0n);

      const candidate = await election.getCandidate(electionId, 0n);
      expect(candidate.voteCount).to.equal(1n);
      expect(await election.hasVoted(electionId, voterA.address)).to.equal(true);
    });

    it("reverts when voting before the election's startTime", async function () {
      const fixture = await deployFixture();
      const { election, registry, electionAdmin, voterA, startTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await registry.connect(electionAdmin).registerVoter(electionId, voterA.address);

      await expect(election.connect(voterA).vote(electionId, 0n))
        .to.be.revertedWithCustomError(election, "VotingNotYetOpen")
        .withArgs(electionId, startTime);
    });

    it("reverts when voting after the election's endTime", async function () {
      const fixture = await deployFixture();
      const { election, registry, electionAdmin, voterA, endTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await registry.connect(electionAdmin).registerVoter(electionId, voterA.address);
      await time.increaseTo(endTime);

      await expect(election.connect(voterA).vote(electionId, 0n))
        .to.be.revertedWithCustomError(election, "VotingAlreadyClosed")
        .withArgs(electionId, endTime);
    });

    it("reverts when the voter is not registered for this election (VoterRegistry check)", async function () {
      const fixture = await deployFixture();
      const { election, unregisteredVoter, startTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await time.increaseTo(startTime + 1);

      await expect(election.connect(unregisteredVoter).vote(electionId, 0n))
        .to.be.revertedWithCustomError(election, "VoterNotRegistered")
        .withArgs(electionId, unregisteredVoter.address);
    });

    it("reverts on double voting by the same address (the most security-critical check)", async function () {
      const fixture = await deployFixture();
      const { election, registry, electionAdmin, voterA, startTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await registry.connect(electionAdmin).registerVoter(electionId, voterA.address);
      await time.increaseTo(startTime + 1);

      await election.connect(voterA).vote(electionId, 0n);

      await expect(election.connect(voterA).vote(electionId, 1n))
        .to.be.revertedWithCustomError(election, "VoterAlreadyVoted")
        .withArgs(electionId, voterA.address);
    });

    it("reverts when voting for a non-existent candidateId", async function () {
      const fixture = await deployFixture();
      const { election, registry, electionAdmin, voterA, startTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await registry.connect(electionAdmin).registerVoter(electionId, voterA.address);
      await time.increaseTo(startTime + 1);

      await expect(election.connect(voterA).vote(electionId, 999n))
        .to.be.revertedWithCustomError(election, "CandidateDoesNotExist")
        .withArgs(electionId, 999n);
    });

    it("reverts when the contract is paused", async function () {
      const fixture = await deployFixture();
      const { election, registry, electionAdmin, systemAdmin, voterA, startTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await registry.connect(electionAdmin).registerVoter(electionId, voterA.address);
      await time.increaseTo(startTime + 1);
      await election.connect(systemAdmin).pause();

      await expect(election.connect(voterA).vote(electionId, 0n)).to.be.revertedWithCustomError(
        election,
        "EnforcedPause",
      );
    });

    it("correctly tallies multiple votes across multiple candidates and voters", async function () {
      const fixture = await deployFixture();
      const { election, registry, electionAdmin, voterA, voterB, startTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await registry.connect(electionAdmin).registerVoter(electionId, voterA.address);
      await registry.connect(electionAdmin).registerVoter(electionId, voterB.address);
      await time.increaseTo(startTime + 1);

      await election.connect(voterA).vote(electionId, 0n); // Alice
      await election.connect(voterB).vote(electionId, 0n); // Alice

      const alice = await election.getCandidate(electionId, 0n);
      const bob = await election.getCandidate(electionId, 1n);
      expect(alice.voteCount).to.equal(2n);
      expect(bob.voteCount).to.equal(0n);
    });
  });

  describe("finalizeElection (ADR-006: explicit finalization transaction)", function () {
    it("allows an admin to finalize after the voting window has closed", async function () {
      const fixture = await deployFixture();
      const { election, electionAdmin, endTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await time.increaseTo(endTime);

      await expect(election.connect(electionAdmin).finalizeElection(electionId))
        .to.emit(election, "ElectionFinalized")
        .withArgs(electionId, electionAdmin.address);

      const data = await election.getElection(electionId);
      expect(data.finalized).to.equal(true);
    });

    it("reverts when finalizing before the voting window has closed", async function () {
      const fixture = await deployFixture();
      const { election, electionAdmin, startTime, endTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await time.increaseTo(startTime + 1);

      await expect(election.connect(electionAdmin).finalizeElection(electionId))
        .to.be.revertedWithCustomError(election, "VotingStillOpen")
        .withArgs(electionId, endTime);
    });

    it("reverts when finalizing an already-finalized election (no double finalization)", async function () {
      const fixture = await deployFixture();
      const { election, electionAdmin, endTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await time.increaseTo(endTime);
      await election.connect(electionAdmin).finalizeElection(electionId);

      await expect(election.connect(electionAdmin).finalizeElection(electionId))
        .to.be.revertedWithCustomError(election, "ElectionAlreadyFinalized")
        .withArgs(electionId);
    });

    it("reverts when called by a non-admin", async function () {
      const fixture = await deployFixture();
      const { election, stranger, endTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await time.increaseTo(endTime);

      await expect(
        election.connect(stranger).finalizeElection(electionId),
      ).to.be.revertedWithCustomError(election, "AccessControlUnauthorizedAccount");
    });

    it("does NOT prevent finalization while paused is irrelevant here, but pause still blocks it (whenNotPaused)", async function () {
      const fixture = await deployFixture();
      const { election, electionAdmin, systemAdmin, endTime } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await time.increaseTo(endTime);
      await election.connect(systemAdmin).pause();

      await expect(
        election.connect(electionAdmin).finalizeElection(electionId),
      ).to.be.revertedWithCustomError(election, "EnforcedPause");
    });
  });

  describe("pause / unpause", function () {
    it("allows SYSTEM_ADMINISTRATOR_ROLE to pause and unpause", async function () {
      const { election, systemAdmin } = await deployFixture();

      await election.connect(systemAdmin).pause();
      expect(await election.paused()).to.equal(true);

      await election.connect(systemAdmin).unpause();
      expect(await election.paused()).to.equal(false);
    });

    it("reverts when an ELECTION_ADMINISTRATOR_ROLE (but not SYSTEM_ADMINISTRATOR_ROLE) holder calls pause", async function () {
      const { election, electionAdmin } = await deployFixture();

      await expect(
        election.connect(electionAdmin).pause(),
      ).to.be.revertedWithCustomError(election, "AccessControlUnauthorizedAccount");
    });

    it("reverts when an ELECTION_ADMINISTRATOR_ROLE (but not SYSTEM_ADMINISTRATOR_ROLE) holder calls unpause (closes a coverage gap: unpause's own access-control branch was previously untested even though pause's was)", async function () {
      const { election, systemAdmin, electionAdmin } = await deployFixture();

      await election.connect(systemAdmin).pause();

      await expect(
        election.connect(electionAdmin).unpause(),
      ).to.be.revertedWithCustomError(election, "AccessControlUnauthorizedAccount");
    });
  });

  describe("view functions", function () {
    it("reverts getElection for a non-existent electionId", async function () {
      const { election } = await deployFixture();

      await expect(election.getElection(999n))
        .to.be.revertedWithCustomError(election, "ElectionDoesNotExist")
        .withArgs(999n);
    });

    it("reverts getCandidate for a non-existent candidateId on a real election", async function () {
      const fixture = await deployFixture();
      const { election } = fixture;
      const electionId = await createElectionWithCandidates(fixture);

      await expect(election.getCandidate(electionId, 999n))
        .to.be.revertedWithCustomError(election, "CandidateDoesNotExist")
        .withArgs(electionId, 999n);
    });
  });
});
