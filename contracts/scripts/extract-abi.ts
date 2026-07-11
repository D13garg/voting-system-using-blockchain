// Extracts just the `abi` field from Hardhat's compiled artifacts into
// shared/abi/*.json — clean, minimal, committed files with no Hardhat
// metadata (bytecode, source maps, debug info) attached.
//
// WHY THIS EXISTS (Phase 3 design decision, see PHASE3 design doc):
// The backend's Blockchain Service Layer (ADR-004) needs the raw ABI as a
// plain JSON array to pass to viem's getContract({ abi, ... }). The two
// options considered were (a) reading directly from contracts/artifacts/
// at backend runtime, or (b) extracting committed ABI JSON files. Option
// (a) was rejected because it would mean the backend's deployability
// depends on the contracts package's full Hardhat toolchain and a
// successful compile existing on whatever machine runs the backend
// (Render/Railway, architecture Section 19) — directly undermining
// ADR-002's "independently deployable API and worker processes" premise.
// This script implements option (b): run once after `hardhat compile`
// (wired as a `postcompile` script in package.json), producing committed,
// versioned ABI files the backend imports with zero Hardhat dependency.
import * as fs from "fs";
import * as path from "path";

interface HardhatArtifact {
  contractName: string;
  abi: unknown[];
}

/**
 * Validates that a freshly-parsed JSON value actually has the shape this
 * script depends on, before trusting it. JSON.parse() returns `any` -
 * assigning that directly to a typed variable would compile but provide
 * no actual runtime guarantee, which matters here specifically because a
 * malformed or unexpectedly-shaped artifact (e.g. from a Hardhat version
 * upgrade changing the artifact format) should fail loudly and
 * immediately, not produce a corrupted or empty ABI file silently written
 * to shared/abi/ for the backend to load later.
 */
function assertIsHardhatArtifact(value: unknown, sourcePath: string): HardhatArtifact {
  if (
    typeof value === "object" &&
    value !== null &&
    "contractName" in value &&
    typeof value.contractName === "string" &&
    "abi" in value &&
    Array.isArray(value.abi)
  ) {
    return value as HardhatArtifact;
  }
  throw new Error(
    `Malformed Hardhat artifact at ${sourcePath}: expected an object with string "contractName" and array "abi" fields.`,
  );
}

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "contracts");
const OUTPUT_DIR = path.join(__dirname, "..", "..", "shared", "abi");

// Only these contracts have a backend-facing ABI extracted. Internal/
// abstract contracts (AccessRoles) and vendored OpenZeppelin contracts are
// deliberately excluded - the backend only ever calls into Election and
// VoterRegistry directly (per ADR-004, Section 7.2: those are the only two
// contracts the Blockchain Service Layer wraps with a typed client).
const CONTRACTS_TO_EXTRACT = ["Election", "VoterRegistry"];

function main(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const contractName of CONTRACTS_TO_EXTRACT) {
    const artifactPath = path.join(ARTIFACTS_DIR, `${contractName}.sol`, `${contractName}.json`);

    if (!fs.existsSync(artifactPath)) {
      throw new Error(
        `Artifact not found for ${contractName} at ${artifactPath}. Run "hardhat compile" first.`,
      );
    }

    const parsed: unknown = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    const artifact = assertIsHardhatArtifact(parsed, artifactPath);

    const outputPath = path.join(OUTPUT_DIR, `${contractName}.json`);
    // Only the abi field is written out - deliberately not bytecode,
    // deployedBytecode, source maps, or any other Hardhat-specific
    // metadata. The backend has no use for any of that, and not writing
    // it keeps these files small and clearly scoped to their one purpose.
    fs.writeFileSync(outputPath, JSON.stringify(artifact.abi, null, 2) + "\n");
    console.log(`Extracted ABI: ${contractName} -> ${path.relative(process.cwd(), outputPath)}`);
  }
}

main();
