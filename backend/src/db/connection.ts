// MongoDB connection bootstrap (shared infrastructure — Section 7.1
// distinguishes this from domain-module Mongoose *schemas*, which live
// inside their owning module, e.g. modules/election/election.model.ts).
//
// Both the API process (src/app.ts) and the worker process
// (worker/worker.ts) call connectDatabase() once at startup. They import
// the exact same Mongoose model definitions, so there is no schema drift
// between the worker (the sole writer of chain-derived collections,
// ADR-002) and the API (a read-only consumer of those same collections).

import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);

  const connection = await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
  });

  logger.info({ db: connection.connection.name }, "MongoDB connected");

  connection.connection.on("error", (err: Error) => {
    // ERROR severity per the logging strategy (Section 17) — a connection
    // error after the initial connect is a recoverable-but-noteworthy
    // event, surfaced to monitoring (Sentry), not a silent retry.
    logger.error({ err }, "MongoDB connection error");
  });

  connection.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected cleanly");
}
