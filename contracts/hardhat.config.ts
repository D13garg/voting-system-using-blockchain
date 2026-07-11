import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
// Explicitly imported, not relying solely on hardhat-toolbox's transitive
// registration of this plugin: under pnpm's strict (non-hoisting)
// node_modules layout, a bare `import "chai"` elsewhere in the dependency
// graph can resolve to a different chai instance than the one this plugin
// patches with .emit()/.revertedWithCustomError() etc, leaving those
// matchers unregistered even though the toolbox is imported. Importing the
// plugin directly here, after the toolbox, removes that ambiguity.
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

// Environment variables are intentionally read directly here, not through
// the backend's centralized Configuration Management layer (Section 18) —
// the contracts package is deployed independently of the backend/worker
// processes and has its own minimal, deployment-only env surface.
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      // Optimizer enabled: gas minimization is an explicit non-functional
      // requirement (Section 2, Section 5) given Sepolia gas costs and the
      // educational goal of demonstrating gas-conscious contract design.
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // Default network for `hardhat test` — fully in-memory, no external
      // RPC dependency, fast iteration for the contract test suite
      // (Phase 2 of the roadmap).
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  typechain: {
    // Generated types are written to shared/abi so the backend's Blockchain
    // Service Layer (ADR-004) and the frontend's Wagmi config consume the
    // exact same typed bindings — one generation step, two consumers, no
    // possibility of ABI drift between backend and frontend.
    outDir: "../shared/abi/typechain-types",
    target: "ethers-v6",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};

export default config;
