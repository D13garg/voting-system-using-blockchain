// Shared Redis connection for BullMQ (Section 8's job queue, ADR-002's
// architecture reserving Redis for exactly this). Same purpose as
// db/connection.ts: one connection, constructed once, imported by every
// module that needs it (Analytics' and Notifications' queues/workers),
// so there's a single place that owns the ioredis client's lifecycle
// rather than each module opening its own.
//
// `maxRetriesPerRequest: null` is not optional here - it's BullMQ's own
// documented requirement for any ioredis connection handed to a Worker
// (a Worker blocks on Redis long-polling commands that ioredis's default
// retry behavior would otherwise interrupt).
//
// Lazily constructed (same pattern as blockchain/index.ts's client
// getters): importing this module - directly or transitively, e.g. via
// analytics.service.ts - never opens a real Redis connection by itself.
// Only actually calling getRedisConnection() does, which is exactly what
// lets analytics.routes.ts's tests (real Mongo, no BullMQ queue ever
// touched) run with no Redis available at all, per this sandbox's known
// restriction.

import { Redis } from "ioredis";
import { env } from "../config/env.js";

let connection: Redis | undefined;

export function getRedisConnection(): Redis {
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

/** Test-only seam. Never called from non-test code. */
export function _resetRedisConnectionForTests(): void {
  connection = undefined;
}