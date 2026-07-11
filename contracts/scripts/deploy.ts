// Deployment script for VoterRegistry + Election.
//
// Per ADR-005, both contracts are non-upgradeable (no proxy deployment
// here) and deployed once per network. Run via:
//   pnpm --filter @dvs/contracts deploy:local    (local Hardhat node)
//   pnpm --filter @dvs/contracts deploy:sepolia  (Sepolia testnet)
//
// IMPORTANT - role handoff (architecture Section 13's production guidance):
// AccessRoles' constructor grants the deploying address BOTH
// SYSTEM_ADMINISTRATOR_ROLE and ELECTION_ADMINISTRATOR_ROLE (see
// AccessRoles.sol's constructor doc comment). This script does NOT
// automatically transfer SYSTEM_ADMINISTRATOR_ROLE to a multisig - that is
// a deliberate, separate, manual step (see the printed instructions at the
// end of this script), because automating "transfer ultimate control away
// from the deployer" inside a script that also deploys the contracts is
// exactly the kind of irreversible action that should require a human to
// explicitly run a second, reviewed step, not happen implicitly as a
// side effect of deployment.
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { readContractAddresses } from "./contractAddresses";

const ADDRESSES_FILE = path.join(__dirname, "..", "..", "shared", "contract-addresses.json");

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`\nDeploying to network: ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer address: ${deployer.address}`);

  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`);

  // --- Deploy VoterRegistry first; Election's constructor needs its address ---
  console.log("\nDeploying VoterRegistry...");
  const VoterRegistryFactory = await ethers.getContractFactory("VoterRegistry");
  const voterRegistry = await VoterRegistryFactory.deploy();
  await voterRegistry.waitForDeployment();
  const voterRegistryAddress = await voterRegistry.getAddress();
  console.log(`VoterRegistry deployed at: ${voterRegistryAddress}`);

  // --- Deploy Election, wired to the VoterRegistry above ---
  console.log("\nDeploying Election...");
  const ElectionFactory = await ethers.getContractFactory("Election");
  const election = await ElectionFactory.deploy(voterRegistryAddress);
  await election.waitForDeployment();
  const electionAddress = await election.getAddress();
  console.log(`Election deployed at: ${electionAddress}`);

  // --- Grant the Election contract's admin role on VoterRegistry to the
  //     SAME address that holds ELECTION_ADMINISTRATOR_ROLE on Election
  //     itself (the deployer, at this point). This is necessary because
  //     VoterRegistry and Election are deployed independently and do NOT
  //     automatically trust each other's role grants - see VoterRegistry.sol:
  //     registerVoter() checks VoterRegistry's OWN AccessControl state, not
  //     Election's. Without this step, the deployer could create elections
  //     and add candidates but could not register any voters. ---
  console.log("\nVerifying role wiring...");
  const registryElectionAdminRole = await voterRegistry.ELECTION_ADMINISTRATOR_ROLE();
  const deployerHasRegistryRole = await voterRegistry.hasRole(registryElectionAdminRole, deployer.address);
  console.log(
    `Deployer holds ELECTION_ADMINISTRATOR_ROLE on VoterRegistry: ${deployerHasRegistryRole} (granted automatically by AccessRoles' constructor, since deployer deployed VoterRegistry directly)`,
  );

  // --- Persist addresses for the backend (Blockchain Service Layer,
  //     ADR-004) and frontend (Wagmi config) to consume. ---
  const addressesFile = readContractAddresses(ADDRESSES_FILE);

  addressesFile[network.name] = {
    chainId: Number(chainId),
    voterRegistry: voterRegistryAddress,
    election: electionAddress,
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
  };

  fs.mkdirSync(path.dirname(ADDRESSES_FILE), { recursive: true });
  fs.writeFileSync(ADDRESSES_FILE, JSON.stringify(addressesFile, null, 2) + "\n");
  console.log(`\nAddresses written to: ${ADDRESSES_FILE}`);

  // --- Manual next steps, intentionally not automated (see header comment) ---
  console.log("\n=== MANUAL NEXT STEPS (not automated by this script) ===");
  console.log("1. If this is a production-intended deployment, transfer");
  console.log("   SYSTEM_ADMINISTRATOR_ROLE to a multisig wallet, then have");
  console.log("   the deployer renounce it:");
  console.log(`     election.grantRole(SYSTEM_ADMINISTRATOR_ROLE, <multisig address>)`);
  console.log(`     election.renounceRole(SYSTEM_ADMINISTRATOR_ROLE, "${deployer.address}")`);
  console.log("   (Repeat for voterRegistry if it should share the same multisig.)");
  console.log("2. If deploying to Sepolia, run the verify script next:");
  console.log("     pnpm --filter @dvs/contracts verify:sepolia");
  console.log("3. Copy the generated ABI from contracts/artifacts/ into");
  console.log("   shared/abi/ for the backend's Blockchain Service Layer");
  console.log("   (Phase 3) to consume.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});