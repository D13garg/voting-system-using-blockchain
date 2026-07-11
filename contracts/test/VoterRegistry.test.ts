import { expect } from "chai";
import { ethers } from "hardhat";
import type { VoterRegistry } from "../../shared/abi/typechain-types/index.js";

describe("VoterRegistry", function () {
  async function deployFixture() {
    const [deployer, electionAdmin, voterA, voterB, stranger] = await ethers.getSigners();

    const VoterRegistryFactory = await ethers.getContractFactory("VoterRegistry");
    const registry = (await VoterRegistryFactory.deploy()) as unknown as VoterRegistry;
    await registry.waitForDeployment();

    // The deployer holds ELECTION_ADMINISTRATOR_ROLE per AccessRoles'
    // constructor (architecture decision: deployer gets both admin roles
    // initially, then a real deployment hands SYSTEM_ADMINISTRATOR_ROLE to
    // a multisig - see scripts/deploy.ts). For these unit tests we also
    // grant the role explicitly to a separate `electionAdmin` signer so
    // tests can distinguish "called by an admin" from "called by the
    // deployer specifically", matching how the real system will have
    // multiple distinct admin addresses.
    const role = await registry.ELECTION_ADMINISTRATOR_ROLE();
    await registry.grantRole(role, electionAdmin.address);

    return { registry, deployer, electionAdmin, voterA, voterB, stranger, role };
  }

  const ELECTION_ID = 1n;
  const OTHER_ELECTION_ID = 2n;

  describe("registerVoter", function () {
    it("allows an ELECTION_ADMINISTRATOR_ROLE holder to register a voter", async function () {
      const { registry, electionAdmin, voterA } = await deployFixture();

      await expect(registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address))
        .to.emit(registry, "VoterRegistered")
        .withArgs(ELECTION_ID, voterA.address, electionAdmin.address);

      expect(await registry.isRegisteredForElection(ELECTION_ID, voterA.address)).to.equal(true);
    });

    it("reverts when called by an address without ELECTION_ADMINISTRATOR_ROLE", async function () {
      const { registry, stranger, voterA } = await deployFixture();

      await expect(
        registry.connect(stranger).registerVoter(ELECTION_ID, voterA.address),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("reverts on double registration for the same election", async function () {
      const { registry, electionAdmin, voterA } = await deployFixture();

      await registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address);

      await expect(registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address))
        .to.be.revertedWithCustomError(registry, "AlreadyRegistered")
        .withArgs(ELECTION_ID, voterA.address);
    });

    it("reverts when registering the zero address", async function () {
      const { registry, electionAdmin } = await deployFixture();

      await expect(
        registry.connect(electionAdmin).registerVoter(ELECTION_ID, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddressVoter");
    });

    it("does NOT make a voter eligible for a different election (per-election eligibility, confirmed design decision)", async function () {
      const { registry, electionAdmin, voterA } = await deployFixture();

      await registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address);

      expect(await registry.isRegisteredForElection(ELECTION_ID, voterA.address)).to.equal(true);
      expect(await registry.isRegisteredForElection(OTHER_ELECTION_ID, voterA.address)).to.equal(false);
    });

    it("allows the same voter to be independently registered for multiple elections", async function () {
      const { registry, electionAdmin, voterA } = await deployFixture();

      await registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address);
      await registry.connect(electionAdmin).registerVoter(OTHER_ELECTION_ID, voterA.address);

      expect(await registry.isRegisteredForElection(ELECTION_ID, voterA.address)).to.equal(true);
      expect(await registry.isRegisteredForElection(OTHER_ELECTION_ID, voterA.address)).to.equal(true);
    });

    it("allows different voters to be registered independently for the same election", async function () {
      const { registry, electionAdmin, voterA, voterB } = await deployFixture();

      await registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address);

      expect(await registry.isRegisteredForElection(ELECTION_ID, voterA.address)).to.equal(true);
      expect(await registry.isRegisteredForElection(ELECTION_ID, voterB.address)).to.equal(false);
    });
  });

  describe("removeVoter", function () {
    it("allows an admin to revoke a previously registered voter's eligibility", async function () {
      const { registry, electionAdmin, voterA } = await deployFixture();

      await registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address);

      await expect(registry.connect(electionAdmin).removeVoter(ELECTION_ID, voterA.address))
        .to.emit(registry, "VoterRemoved")
        .withArgs(ELECTION_ID, voterA.address, electionAdmin.address);

      expect(await registry.isRegisteredForElection(ELECTION_ID, voterA.address)).to.equal(false);
    });

    it("reverts when removing a voter who is not currently registered", async function () {
      const { registry, electionAdmin, voterA } = await deployFixture();

      await expect(registry.connect(electionAdmin).removeVoter(ELECTION_ID, voterA.address))
        .to.be.revertedWithCustomError(registry, "NotCurrentlyRegistered")
        .withArgs(ELECTION_ID, voterA.address);
    });

    it("reverts when called by an address without ELECTION_ADMINISTRATOR_ROLE", async function () {
      const { registry, electionAdmin, stranger, voterA } = await deployFixture();

      await registry.connect(electionAdmin).registerVoter(ELECTION_ID, voterA.address);

      await expect(
        registry.connect(stranger).removeVoter(ELECTION_ID, voterA.address),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("role setup (AccessRoles constructor)", function () {
    it("grants the deployer both admin roles at construction", async function () {
      const { registry, deployer, role } = await deployFixture();

      const systemRole = await registry.SYSTEM_ADMINISTRATOR_ROLE();
      expect(await registry.hasRole(role, deployer.address)).to.equal(true);
      expect(await registry.hasRole(systemRole, deployer.address)).to.equal(true);
    });
  });
});
