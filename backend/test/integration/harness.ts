// Test harness for the Phase 3 blockchain integration test
// (blockchain.integration.test.ts).
//
// What this does, and why:
// 1. Spawns a REAL local Hardhat node (`npx hardhat node`, from
//    contracts/) - not a mock, not viem's test client. The whole point of
//    this test is to exercise ElectionContractClient/
//    VoterRegistryContractClient against actual deployed bytecode.
// 2. Deploys via the project's REAL `scripts/deploy.ts`
//    (`hardhat run scripts/deploy.ts --network localhost`) - the same
//    deploy path a real deployment uses, not a test-only shortcut. This
//    also runs `postcompile` (extract-abi.ts), so `shared/abi/*.json`
//    ends up fresh for whatever contract version is on disk.
// 3. Grants a freshly-generated "backend signer" account
//    ELECTION_ADMINISTRATOR_ROLE on both contracts. This does NOT reflect
//    a production recommendation - the architecture deliberately keeps
//    BACKEND_SIGNER_PRIVATE_KEY low-privilege and distinct from any admin
//    key (signer.ts's header comment). This is a test-only setup step,
//    explicitly chosen (see HANDOFF.md's Phase 3 integration test design
//    discussion) to mirror what a real ops action granting a service
//    account elevated privilege would look like, so the write-path tests
//    below can exercise a genuine success path, not just reverts.
// 4. Seeds one election + one candidate via RAW contract calls (NOT
//    through ElectionContractClient - createElection/addCandidate are
//    deliberately absent from that interface; see
//    IElectionContractClient.ts's header comment for why). This harness
//    is test setup, not something the reusable client classes need to
//    support.
//
// IMPORTANT: this requires `hardhat compile` to succeed at least once,
// which requires network access to binaries.soliditylang.org. Some
// sandboxed environments block that host (see HANDOFF.md's verification
// discipline section) - in that case this harness's setup() will throw
// during the deploy step, and that is the correct, expected outcome: this
// test genuinely cannot run without a working Hardhat toolchain. It is
// intentionally excluded from the default `pnpm test` run (see
// vitest.integration.config.ts) for exactly this reason.

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { createPublicClient, createWalletClient, decodeEventLog, http, type Address, type Hex, type Log, type PublicClient, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import electionAbiJson from "../../../shared/abi/Election.json" with { type: "json" };
import voterRegistryAbiJson from "../../../shared/abi/VoterRegistry.json" with { type: "json" };

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.join(__dirname, "..", "..", "..", "contracts");
const ADDRESSES_FILE = path.join(__dirname, "..", "..", "..", "shared", "contract-addresses.json");
export const RPC_URL = "http://127.0.0.1:8545";

const NODE_READY_TIMEOUT_MS = 30_000;
const NODE_READY_POLL_INTERVAL_MS = 500;

export interface SeededChainState {
  voterRegistryAddress: Address;
  electionAddress: Address;
  /** electionId of the single election seeded by this harness. */
  electionId: bigint;
  /** candidateId of the single candidate seeded by this harness. */
  candidateId: bigint;
  /** Unix seconds. The election's endTime already has (deliberately) passed by the time setup() returns. */
  endTime: bigint;
  /** Freshly generated - never the deployer/admin key. Holds ELECTION_ADMINISTRATOR_ROLE on both contracts (test-only setup, see header comment). */
  backendSignerPrivateKey: Hex;
  backendSignerAddress: Address;
  /** A second, never-registered address - useful for tests that need a "not yet eligible" voter. */
  unregisteredVoterAddress: Address;
}

let nodeProcess: ChildProcess | undefined;

/**
 * Starts the local Hardhat node, deploys, grants roles, and seeds one
 * election + candidate. Call once from a suite's beforeAll(). Idempotent
 * within a single node lifecycle is NOT guaranteed - call teardown()
 * before calling setup() again.
 */
export async function setup(): Promise<SeededChainState> {
  const publicClient = createPublicClient({ chain: hardhat, transport: http(RPC_URL) });

  // Fail with a clear, actionable message if port 8545 is STILL occupied
  // after a short grace period - almost always a leftover `hardhat node`
  // process from a previous run that didn't get torn down. Without this
  // check, a stale process on the port produces a much more confusing
  // failure much later (this harness's own readiness check passing
  // against the OLD process, then the separate `hardhat run --network
  // localhost` deploy subprocess intermittently racing/failing against
  // it - see HANDOFF.md's Phase 3 section for the flaky fail/pass
  // pattern this caused before this check existed).
  //
  // This is deliberately a short RETRY loop, not a single check: a
  // process from the immediately-preceding run that was just sent
  // SIGTERM (by that run's own teardown(), or by a person running `pkill`
  // between runs) can take a moment to actually exit and release the
  // port - that's a normal, brief shutdown delay, not a stuck orphan, and
  // hard-failing on the very first hit produced exactly this: a run
  // immediately following a previous run intermittently failing here even
  // though nothing was actually wrong (confirmed against a real run - see
  // HANDOFF.md's Phase 3 section). Only fail if something is STILL
  // responding after the grace period.
  const PORT_CHECK_GRACE_MS = 8_000;
  const portCheckDeadline = Date.now() + PORT_CHECK_GRACE_MS;
  let portOccupied = false;
  do {
    try {
      await publicClient.getBlockNumber();
      portOccupied = true;
      if (Date.now() < portCheckDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch {
      // Connection-refused-shaped error: nothing is listening. Port is
      // genuinely free - proceed.
      portOccupied = false;
      break;
    }
  } while (Date.now() < portCheckDeadline);
  if (portOccupied) {
    throw new Error(
      `Port 8545 is still in use by something that responds to JSON-RPC after an ${PORT_CHECK_GRACE_MS / 1000}s ` +
        `grace period - this is a genuinely stuck process, not just the previous run still shutting down. Run ` +
        `\`lsof -i :8545\` (or \`pgrep -fa hardhat\`) to find it, \`pkill -f "hardhat node"\` to stop it, confirm ` +
        `\`lsof -i :8545\` prints nothing, then re-run this suite.`,
    );
  }

  // detached: true makes this the leader of its own process group rather
  // than a plain child of this Node process. `npx` frequently execs
  // `hardhat node` as a further child of itself (effectively a
  // grandchild of this harness) - on teardown, killing only the tracked
  // top-level PID does not reliably reach that grandchild, which can
  // then survive as an orphan still holding port 8545 for the next run.
  // Killing the whole process GROUP (see teardown() below) reaches both.
  nodeProcess = spawn("npx", ["hardhat", "node"], {
    cwd: CONTRACTS_DIR,
    stdio: "pipe",
    detached: true,
  });

  // Surface node output on failure - silent child-process failures are
  // the single hardest thing to debug in this kind of harness.
  let nodeOutput = "";
  nodeProcess.stdout?.on("data", (chunk: Buffer) => {
    nodeOutput += chunk.toString();
  });
  nodeProcess.stderr?.on("data", (chunk: Buffer) => {
    nodeOutput += chunk.toString();
  });
  nodeProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`hardhat node exited early with code ${code}. Output:\n${nodeOutput}`);
    }
  });

  await waitForNodeReady(publicClient, nodeOutput);

  // Real deploy path - same command a real deployment uses. Runs
  // `postcompile` (extract-abi.ts) first via the `compile` npm script's
  // hook, so shared/abi/*.json is fresh before we import it above... EXCEPT
  // this file's top-level ABI imports already happened at module-load
  // time, before this function ran. That's fine: extract-abi.ts's ABI
  // shape (the `abi` field of a Hardhat artifact) doesn't change between
  // compiles unless the contract's public interface itself changed, which
  // isn't something this test suite does. If a future contract change
  // updates the ABI, re-running `pnpm --filter @dvs/contracts compile`
  // once before running this suite refreshes the checked-in JSON.
  try {
    execFileSync("npx", ["hardhat", "run", "scripts/deploy.ts", "--network", "localhost"], {
      cwd: CONTRACTS_DIR,
      stdio: "inherit",
    });
  } catch (error) {
    await teardown();
    throw new Error(
      "Deploy failed - see output above. This commonly means `hardhat compile` couldn't run " +
        "(e.g. no network access to binaries.soliditylang.org). This integration test requires " +
        "a working Hardhat toolchain and cannot run without one.",
      { cause: error },
    );
  }

  const addresses = readAddresses();
  const localhost = addresses.localhost;
  if (!localhost) {
    await teardown();
    throw new Error(`Deploy succeeded but shared/contract-addresses.json has no "localhost" entry.`);
  }

  const [deployerAddress] = await publicClient.request({ method: "eth_accounts", params: [] });
  const deployerWalletClient: WalletClient = createWalletClient({
    account: deployerAddress as Address,
    chain: hardhat,
    transport: http(RPC_URL),
  });

  const backendSignerPrivateKey = generatePrivateKey();
  const backendSignerAccount = privateKeyToAccount(backendSignerPrivateKey);
  const unregisteredVoterAccount = privateKeyToAccount(generatePrivateKey());

  // Fund the test signer directly via Hardhat's dev RPC method - simpler
  // and faster than a real funding transaction, and this is chain state
  // that only exists for the lifetime of this throwaway node.
  await publicClient.request({
    method: "hardhat_setBalance" as never,
    params: [backendSignerAccount.address, "0x56BC75E2D63100000"] as never, // 100 ETH
  });

  const electionAddress = localhost.election as Address;
  const voterRegistryAddress = localhost.voterRegistry as Address;
  const electionAbi = electionAbiJson;
  const voterRegistryAbi = voterRegistryAbiJson;

  const electionAdminRole = await publicClient.readContract({
    address: electionAddress,
    abi: electionAbi,
    functionName: "ELECTION_ADMINISTRATOR_ROLE",
  });
  const registryAdminRole = await publicClient.readContract({
    address: voterRegistryAddress,
    abi: voterRegistryAbi,
    functionName: "ELECTION_ADMINISTRATOR_ROLE",
  });

  await sendAndWait(publicClient, deployerWalletClient, {
    address: electionAddress,
    abi: electionAbi,
    functionName: "grantRole",
    args: [electionAdminRole, backendSignerAccount.address],
  });
  await sendAndWait(publicClient, deployerWalletClient, {
    address: voterRegistryAddress,
    abi: voterRegistryAbi,
    functionName: "grantRole",
    args: [registryAdminRole, backendSignerAccount.address],
  });

  // Seed one election. startTime is set a full hour ahead - NOT because
  // voting timing matters for what this suite tests, but because several
  // real transactions (both role grants above, then createElection
  // itself) each take real wall-clock time to submit and confirm before
  // addCandidate runs. An earlier version of this harness used only a
  // few seconds' margin and addCandidate intermittently reverted with
  // CannotAddCandidateAfterVotingStarts once startTime had already
  // elapsed by the time that call actually landed - a real bug, caught
  // by an actual run against a real chain (see HANDOFF.md's Phase 3
  // section), which is exactly the kind of timing issue no amount of
  // type-checking or mocking would have caught. After addCandidate,
  // chain time is fast-forwarded well past endTime explicitly (below),
  // so the test suite doesn't need to wait out a real hour.
  const latestBlock = await publicClient.getBlock();
  const startTime = latestBlock.timestamp + 3600n;
  const endTime = startTime + 3600n;

  const createReceipt = await sendAndWait(publicClient, deployerWalletClient, {
    address: electionAddress,
    abi: electionAbi,
    functionName: "createElection",
    args: ["Integration Test Election", startTime, endTime],
  });
  const electionId = decodeElectionIdFromCreateReceipt(createReceipt, electionAbi);

  await sendAndWait(publicClient, deployerWalletClient, {
    address: electionAddress,
    abi: electionAbi,
    functionName: "addCandidate",
    args: [electionId, "Alice", "ipfs://alice-metadata"],
  });
  const candidateId = 0n; // first candidate added to a freshly created election

  // Advance chain time past endTime (not just to it - past it) so
  // finalizeElection() won't revert with VotingStillOpen when the test
  // suite calls it. 2 real hours' worth of margin (startTime + endTime
  // above) plus this jump, done via Hardhat's dev RPC methods rather
  // than actually waiting, so the suite still runs in seconds.
  await publicClient.request({ method: "evm_increaseTime" as never, params: [7300] as never });
  await publicClient.request({ method: "evm_mine" as never, params: [] as never });

  return {
    voterRegistryAddress,
    electionAddress,
    electionId,
    candidateId,
    endTime,
    backendSignerPrivateKey,
    backendSignerAddress: backendSignerAccount.address,
    unregisteredVoterAddress: unregisteredVoterAccount.address,
  };
}

export async function teardown(): Promise<void> {
  if (!nodeProcess) return;
  const proc = nodeProcess;
  nodeProcess = undefined;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    // Negative PID targets the whole process GROUP on POSIX, not just the
    // single tracked process - necessary because `npx` frequently execs
    // `hardhat node` as a further child of itself, and killing only the
    // top-level PID can leave that grandchild alive, still holding port
    // 8545, as an orphan for the next run. Requires the `detached: true`
    // spawn option (set in setup()) to make this process its own group
    // leader in the first place.
    try {
      process.kill(-proc.pid!, "SIGTERM");
    } catch {
      // Process (or its group) may already be gone - fine.
    }
    // Fallback in case the process doesn't respond to SIGTERM promptly.
    setTimeout(() => {
      if (!proc.killed) {
        try {
          process.kill(-proc.pid!, "SIGKILL");
        } catch {
          // Already gone - fine.
        }
      }
      resolve();
    }, 5000);
  });
}

async function waitForNodeReady(publicClient: PublicClient, nodeOutputRef: string): Promise<void> {
  const deadline = Date.now() + NODE_READY_TIMEOUT_MS;
  let lastError: unknown;
  // Require 2 consecutive successful reads, not just 1, before declaring
  // the node ready. A single success intermittently happened just as the
  // node's TCP listener came up but before it was fully wired to accept
  // fresh connections from a SEPARATE process (this harness's own
  // publicClient succeeding, then the independently-spawned `hardhat run
  // --network localhost` deploy subprocess moments later failing to
  // connect at all - see HANDOFF.md's Phase 3 section for the observed
  // fail/pass/fail/pass flake this caused before this check existed).
  let consecutiveSuccesses = 0;
  while (Date.now() < deadline) {
    try {
      await publicClient.getBlockNumber();
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses >= 2) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      lastError = error;
      consecutiveSuccesses = 0;
      await new Promise((resolve) => setTimeout(resolve, NODE_READY_POLL_INTERVAL_MS));
    }
  }
  await teardown();
  throw new Error(
    `Hardhat node did not become ready on ${RPC_URL} within ${NODE_READY_TIMEOUT_MS}ms. ` +
      `Output so far:\n${nodeOutputRef}`,
    { cause: lastError },
  );
}

function readAddresses(): Record<string, { chainId: number; voterRegistry: string; election: string }> {
  const raw = fs.readFileSync(ADDRESSES_FILE, "utf-8");
  return JSON.parse(raw) as Record<string, { chainId: number; voterRegistry: string; election: string }>;
}

// call is deliberately `any` here: a generic raw-ABI write helper for test
// setup only (not part of the reusable client surface), used with several
// different contract call shapes above.
async function sendAndWait(publicClient: PublicClient, walletClient: WalletClient, call: any) {
  const hash = await walletClient.writeContract({
    ...call,
    chain: hardhat,
    account: walletClient.account!,
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

function decodeElectionIdFromCreateReceipt(receipt: { logs: Log[] }, electionAbi: unknown): bigint {
  // createElection's electionId equals the pre-increment value of
  // _electionCount, and this harness only ever creates one election on a
  // freshly deployed contract, so it is always 0. Asserting this via the
  // emitted ElectionCreated event (rather than hardcoding 0n) keeps this
  // harness correct if it's ever extended to seed more than one election.
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: electionAbi as never, data: log.data, topics: log.topics });
      if (decoded.eventName === "ElectionCreated") {
        return (decoded.args as { electionId: bigint }).electionId;
      }
    } catch {
      continue;
    }
  }
  throw new Error("createElection succeeded but no ElectionCreated event was found in the receipt.");
}