// Standalone compilation check using the solc npm package directly.
//
// WHY THIS FILE EXISTS: `hardhat compile` / `hardhat test` need Hardhat's
// own compiler-binary downloader to fetch a native solc binary from
// binaries.soliditylang.org. In network-restricted environments (e.g. a
// sandboxed CI runner with an egress allowlist that doesn't include that
// host), that download fails with HH502, even though the actual Solidity
// source is perfectly valid. This script compiles the same contracts using
// the @solc npm package (the WASM build, fetched legitimately from the npm
// registry) so correctness can be verified without that network
// dependency.
//
// This is a verification aid, not a replacement for Hardhat. Run
// `pnpm --filter @dvs/contracts compile` and `pnpm --filter @dvs/contracts
// test` as the real build/test commands in any environment with normal
// network access (a developer machine, GitHub Actions, etc).
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const contractsDir = path.join(__dirname, "contracts");
const nodeModules = path.join(__dirname, "node_modules");

function findImports(importPath) {
  // Resolve @openzeppelin/... imports against node_modules, and local
  // ./Foo.sol imports against the contracts/ directory - mirrors how
  // Hardhat itself resolves imports.
  try {
    let resolved;
    if (importPath.startsWith(".")) {
      resolved = path.join(contractsDir, importPath);
    } else {
      resolved = path.join(nodeModules, importPath);
    }
    return { contents: fs.readFileSync(resolved, "utf8") };
  } catch (e) {
    return { error: "File not found: " + importPath };
  }
}

const sources = {};
for (const file of fs.readdirSync(contractsDir)) {
  if (file.endsWith(".sol")) {
    sources[file] = { content: fs.readFileSync(path.join(contractsDir, file), "utf8") };
  }
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hasError = false;
if (output.errors) {
  for (const err of output.errors) {
    if (err.severity === "error") {
      hasError = true;
      console.error("ERROR:", err.formattedMessage);
    } else {
      console.warn("WARNING:", err.formattedMessage);
    }
  }
}

if (hasError) {
  console.error("\nCompilation FAILED.");
  process.exit(1);
}

console.log("\nCompilation SUCCEEDED. Contracts:");
for (const file of Object.keys(output.contracts || {})) {
  for (const contractName of Object.keys(output.contracts[file])) {
    const bytecodeLen = output.contracts[file][contractName].evm.bytecode.object.length / 2;
    console.log(`  - ${file}:${contractName} (${bytecodeLen} bytes bytecode)`);
  }
}
