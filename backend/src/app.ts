// API process entrypoint (ADR-002: this is one of two independently
// deployed processes — see worker/worker.ts for the other).
//
// This file is deliberately thin. It wires up middleware, connects to
// MongoDB, mounts domain module routers, and starts listening — it
// contains no business logic itself ("Business logic must never exist
// inside controllers" applies a fortiori to the entrypoint, which is one
// layer above controllers).
//
// This process NEVER opens a blockchain event subscription and NEVER
// writes to chain-derived collections (IndexedVoteEvent, AnalyticsRollup)
// — that is exclusively the worker's responsibility (ADR-002, ADR-003).

import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttpFactory from "pino-http";
import swaggerUi from "swagger-ui-express";

// pino-http ships a CJS function export (`module.exports = pinoHttp`). Its
// .d.ts declares an overloaded `declare function`, which some combinations
// of TypeScript + NodeNext module resolution fail to treat as callable when
// re-exported through esModuleInterop's default-import shim. Casting to the
// known-correct callable signature here is narrowly scoped to this import
// line — every call site below remains fully typed against pino-http's own
// Options/HttpLogger types.
const pinoHttp = pinoHttpFactory as unknown as (
  opts: import("pino-http").Options,
) => import("pino-http").HttpLogger;


import { env } from "./config/env.js";
import { buildOpenApiSpec } from "./config/swagger.js";
import { connectDatabase } from "./db/connection.js";
import { logger } from "./shared/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { generalWriteLimiter } from "./middleware/rateLimiter.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { electionRouter } from "./modules/election/election.routes.js";
import { votingRouter } from "./modules/voting/voting.routes.js";
import { adminRouter, votersRouter } from "./modules/admin/admin.routes.js";
import { candidateRouter } from "./modules/candidate/candidate.routes.js";
import { ipfsRouter } from "./modules/ipfs/ipfs.routes.js";
import { analyticsRouter } from "./modules/analytics/analytics.routes.js";
import { notificationRouter } from "./modules/notifications/notification.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";

const apiLogger = logger.child({ service: "api" });

// Exported separately from bootstrap() below so tests can construct a real
// Express app (with real middleware, real routers) against an
// already-connected test database, without also connecting to a real
// MongoDB or binding a real port as a side effect of import - see
// test/auth/auth.routes.test.ts.
export function buildApp(): Express {
  const app = express();

  // Confirmed (see rateLimiter.ts's header comment): this deployment sits
  // behind exactly one reverse proxy (Render/Railway/similar PaaS), so
  // `req.ip` should trust exactly one hop of X-Forwarded-For - `1`, not
  // `true` (which would trust every hop, letting a client spoof its own
  // IP by sending its own X-Forwarded-For header). This MUST be set
  // before generalWriteLimiter/authNonceOrSiweLimiter are ever hit, since
  // both key on req.ip.
  app.set("trust proxy", 1);

  app.use(helmet());
  // origin + credentials:true are both required together - the SIWE
  // session cookie is httpOnly and the frontend is a separate origin, so
  // a credentialed fetch needs an exact origin echoed back, not cors()'s
  // default wildcard (which the browser rejects outright for any
  // credentialed request). See env.ts's FRONTEND_ORIGIN comment.
  app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(pinoHttp({ logger: apiLogger }));
  app.use(requestLogger);
  // Global, but internally a no-op for GET/HEAD/OPTIONS (see its own
  // comment) - covers Section 24's "public write endpoints" scope across
  // every router mounted below without repeating it per-route. The
  // auth module's two zero-auth endpoints ALSO get a second, stricter,
  // route-specific limiter - see auth.routes.ts.
  app.use(generalWriteLimiter);

  // Health check architecture (architecture Section 24 / production
  // readiness enhancements). /health is liveness; /ready will be extended
  // in a later phase to also verify the MongoDB connection state before
  // domain module routers are mounted.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // OpenAPI docs (architecture.md line 511). Approved forked decision
  // (HANDOFF.md Gap #2): dev/test only, never mounted in production - an
  // internal API-surface map is not something this deployment wants
  // publicly browsable. Both routes are entirely absent (404, not an
  // empty/error response) when NODE_ENV === "production", so there's no
  // ambiguity from the outside about whether this is "on but empty" vs.
  // genuinely not mounted.
  if (env.NODE_ENV !== "production") {
    const openApiSpec = buildOpenApiSpec();
    app.get("/api-docs.json", (_req, res) => {
      res.status(200).json(openApiSpec);
    });
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
  }

  // Domain module routers (Phase 5, Section 7.1). Auth is the first
  // (Section 7.3) - other modules (Election, Voting, Admin, ...) mount
  // here as they're built, several of them depending on
  // modules/auth/auth.middleware.ts's requireAuth to gate their own
  // routes.
  app.use("/auth", authRouter);
  app.use("/elections", electionRouter);
  app.use("/elections", votingRouter);
  app.use("/voters", votersRouter);
  app.use("/admin", adminRouter);
  app.use("/admin", auditRouter);
  app.use("/elections", candidateRouter);
  app.use("/elections", notificationRouter);
  app.use("/ipfs", ipfsRouter);
  app.use("/analytics", analyticsRouter);

  app.use(errorHandler);

  return app;
}

async function bootstrap(): Promise<Express> {
  await connectDatabase();
  return buildApp();
}

// Bootstraps and listens ONLY when this module is the actual process
// entrypoint (`node dist/app.js` / `tsx src/app.ts`), never as a side
// effect of some other module importing it - which is exactly what every
// test file that needs a real Express instance does (see buildApp's own
// header comment above). Before this guard existed, every test file that
// imported app.js also triggered a real app.listen(env.API_PORT) as an
// import side effect; with a single test file that was silently harmless
// (nothing else competed for the port), but became a real EADDRINUSE
// crash the moment a second test file (Election's) also imported app.js
// in its own worker process - caught by the user's real `pnpm test` run,
// not by tsc/eslint. See HANDOFF.md's Phase 5 Election section.
if (env.NODE_ENV !== "test") {
  bootstrap()
    .then((app) => {
      app.listen(env.API_PORT, () => {
        apiLogger.info({ port: env.API_PORT }, "API process listening");
      });
    })
    .catch((err: unknown) => {
      apiLogger.error({ err }, "API process failed to start");
      process.exit(1);
    });
}