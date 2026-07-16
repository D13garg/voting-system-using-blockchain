// Etherscan verification script. Run after deploy:sepolia, once
// shared/contract-addresses.json has been populated for Sepolia's chainId
// (11155111) entry.
//
// Public verification matters here specifically because the architecture's
// core claim is independent verifiability (Section 14, step 9: "Verifying
// votes ... any user can independently query the contract or Etherscan").
// An unverified contract on Etherscan only shows bytecode, not readable
// source - verification is what actually makes that claim true in
// practice, not just in principle.
import { run, network, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { readContractAddresses } from "./contractAddresses";

const ADDRESSES_FILE = path.join(__dirname, "..", "..", "shared", "contract-addresses.json");

async function main(): Promise<void> {
  if (!fs.existsSync(ADDRESSES_FILE)) {
    throw new Error(
      `${ADDRESSES_FILE} not found. Run the deploy script first (pnpm --filter @dvs/contracts deploy:sepolia).`,
    );
  }

  const addresses = readContractAddresses(ADDRESSES_FILE);
  // Keyed by chainId, not network.name - see contractAddresses.ts's header
  // comment and deploy.ts's matching write for why.
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const networkEntry = addresses[String(chainId)];

  if (!networkEntry) {
    throw new Error(
      `No deployment recorded for chain ${chainId} (network "${network.name}") in ${ADDRESSES_FILE}. Deploy first.`,
    );
  }

  console.log(`Verifying VoterRegistry at ${networkEntry.voterRegistry}...`);
  try {
    await run("verify:verify", {
      address: networkEntry.voterRegistry,
      constructorArguments: [], // VoterRegistry's constructor takes no arguments
    });
  } catch (error) {
    logVerificationOutcome("VoterRegistry", error);
  }

  console.log(`\nVerifying Election at ${networkEntry.election}...`);
  try {
    await run("verify:verify", {
      address: networkEntry.election,
      constructorArguments: [networkEntry.voterRegistry], // Election's constructor takes the VoterRegistry address
    });
  } catch (error) {
    logVerificationOutcome("Election", error);
  }
}

function logVerificationOutcome(contractName: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("already verified")) {
    console.log(`${contractName} is already verified.`);
  } else {
    console.error(`${contractName} verification failed:`, message);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});