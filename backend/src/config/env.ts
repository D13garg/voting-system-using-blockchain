// Centralized, validated environment configuration (architecture Section 18).
//
// Rationale: every required environment variable is declared exactly once,
// here, with a zod schema. Both the API process (src/app.ts) and the worker
// process (worker/worker.ts) import `env` from this module rather than
// reading `process.env` directly anywhere else in the codebase. A missing
// or malformed variable fails immediately at process startup with a clear
// error, instead of surfacing as a confusing runtime failure deep inside a
// request handler or job processor.
//
// This module deliberately has zero dependencies on any domain module —
// it is shared infrastructure (see Section 7.1's distinction between
// domain modules and shared infrastructure like config/, middleware/, db/).

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Blockchain config (consumed by the Blockchain Service Layer, ADR-004) ---
  RPC_URL_PRIMARY: z.string().url().describe("Alchemy Sepolia RPC endpoint"),
  RPC_URL_FALLBACK: z.string().url().describe("Infura Sepolia RPC endpoint"),

  CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  CONTRACT_ADDRESS_VOTER_REGISTRY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid Ethereum address"),
  CONTRACT_ADDRESS_ELECTION: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid Ethereum address"),
  // Backend-held signer key is intentionally low-privilege and distinct
  // from any deployer or admin key (ADR-004) — it is never used to submit
  // votes or registrations on a user's behalf (ADR-003).
  BACKEND_SIGNER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),

  // --- Wallet module config (ENS resolution, architecture Section 7.1) ---
  // Deliberately a SEPARATE client from RPC_URL_PRIMARY/FALLBACK above:
  // real ENS names (`alice.eth`) are registered on Ethereum MAINNET, not
  // Sepolia - Hardhat's local network has no ENS contracts at all, and
  // Sepolia's own ENS deployment is a sparse test registry, not where
  // real names live. Optional and independently failable: ENS resolution
  // is a "nice to have" display enhancement (Section 1's Nice-to-Have
  // list has no ENS entry at all), never load-bearing for voting/auth, so
  // an unset or unreachable mainnet RPC must degrade to "no ENS name
  // resolved" rather than fail startup or any request - see
  // wallet.service.ts.
  RPC_URL_MAINNET_ENS: z.string().url().optional(),

  // --- MongoDB config ---
  MONGODB_URI: z.string().min(1),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // --- Redis / BullMQ config (worker job queue, ADR-002) ---
  REDIS_URL: z.string().min(1),

  // --- Worker config (Phase 6, Section 8) ---
  // Block number to start indexing from when no checkpoint exists yet in
  // MongoDB (WorkerCheckpointModel) - typically the contracts' actual
  // deployment block, so a fresh worker doesn't scan the entire chain
  // history from genesis. Defaults to 0 for local/Hardhat development
  // where genesis IS the deployment block; production configuration
  // should set this explicitly to the real Sepolia deployment block.
  WORKER_START_BLOCK: z.coerce.bigint().default(0n),

  // How long the worker's checkpoint can go without advancing before it's
  // treated as a CRITICAL-severity stall (architecture Section 17's own
  // canonical example: "Worker has not processed a new block in 10
  // minutes"). See src/modules/indexing/stallDetector.ts. Configurable
  // rather than hardcoded because "how long is too long" is an
  // operational/alerting-threshold call, not a fixed protocol constant
  // the way WORKER_START_BLOCK's semantics are.
  WORKER_STALL_CRITICAL_MS: z.coerce.number().int().positive().default(600_000),

  // Gap #7 (election-start reminder). ELECTION_START_SCAN_INTERVAL_MS is
  // the BullMQ repeatable job's own interval - how often the scan runs,
  // not how far in advance it warns. ELECTION_START_REMINDER_LEAD_TIME_MS
  // is that separate "how far in advance" question - see
  // electionStartScan.worker.ts. Both configurable env vars, not
  // hardcoded constants, following the same "operational threshold, not
  // a fixed protocol value" reasoning WORKER_STALL_CRITICAL_MS's own
  // comment above gives (and the same approved-decision precedent from
  // gap #5).
  ELECTION_START_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  ELECTION_START_REMINDER_LEAD_TIME_MS: z.coerce.number().int().positive().default(3_600_000),

  // --- IPFS config ---
  IPFS_API_KEY: z.string().min(1),
  IPFS_API_SECRET: z.string().min(1),
  IPFS_GATEWAY_URL: z.string().url().default("https://w3s.link"),

  // --- Notification config (Resend, Section 8's notification dispatch) ---
  RESEND_API_KEY: z.string().min(1),
  NOTIFICATION_FROM_EMAIL: z.string().min(1).default("notifications@dvs.example.com"),

  // --- Auth config (SIWE) ---
  SIWE_DOMAIN: z.string().min(1),
  SIWE_SESSION_SECRET: z.string().min(32, "session secret should be at least 32 characters"),
  SIWE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

  // --- CORS config ---
  // The SIWE session is an httpOnly cookie, and the frontend runs on a
  // different origin (Vite dev server, or a separate deployed domain in
  // production) than this API. A credentialed cross-origin request
  // (fetch with credentials:'include') is rejected outright by the
  // browser unless the server names this exact origin - the wildcard
  // `*` that cors() defaults to is not allowed for credentialed
  // requests at all, so a specific origin is not optional here the way
  // it might be for a public, cookie-less API. See app.ts's cors(...)
  // call. No default: forgetting to set this should fail loudly at
  // startup (Section 18's core rationale), not silently break auth.
  FRONTEND_ORIGIN: z.string().url(),

  // --- External services / monitoring ---
  SENTRY_DSN: z.string().url().optional(),
  TENDERLY_PROJECT_SLUG: z.string().optional(),

  // --- Process-level ---
  API_PORT: z.coerce.number().int().positive().default(4000),
  // "fatal" added alongside architecture Section 17's CRITICAL severity
  // tier (see stallDetector.ts) - pino's own built-in level, one step
  // above "error", used only for system-level failures requiring
  // immediate response (e.g. the worker stall alert), never for ordinary
  // request/job-level errors.
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),



  
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Intentionally thrown, not logged-and-continued: an invalid
    // configuration must never allow the process to limp into a partially
    // configured state (Section 18's core rationale).
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  return parsed.data;
}

export const env: Env = loadEnv();