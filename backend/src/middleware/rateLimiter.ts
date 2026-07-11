// Rate limiting (architecture Section 24: "Rate limiting on public write
// endpoints"; Section 7.1 lists it under shared `middleware/`
// infrastructure, not a domain module).
//
// Approved design forks (see chat history / HANDOFF.md):
// - Library: rate-limiter-flexible, not express-rate-limit.
// - Store: the EXISTING shared Redis connection (shared/redis.ts's
//   getRedisConnection()) - correct under horizontal scaling, costs
//   nothing new operationally since Redis is already mandatory infra.
// - Client identity: `req.ip`, correct only because app.ts sets
//   `trust proxy` (confirmed: one reverse proxy in front) - see app.ts.
//
// CRITICAL TEST-ISOLATION DESIGN (found and fixed during this gap's own
// implementation, not something the design doc anticipated): every OTHER
// domain module that touches BullMQ (Analytics, Notifications) defines a
// minimal IJobQueue interface and injects a fake test double specifically
// so its own tests never open a real Redis connection - see
// notification.queue.ts/analytics.queue.ts's own header comments. Naively
// mounting a Redis-backed limiter globally in app.ts would have silently
// broken that convention for every OTHER domain module's existing tests
// the moment they exercised any POST/PUT/PATCH/DELETE route (admin,
// candidate, election, ipfs, notifications, auth) - none of those test
// files know anything about rate limiting and inject no fake for it.
//
// Fixed the same way this codebase always fixes this problem: a minimal
// IRateLimiter interface (real RedisRateLimiter vs. injectable fakes),
// PLUS defaulting to a no-op limiter automatically when
// env.NODE_ENV === "test" - same "don't do the real thing during tests
// unless told to" philosophy as app.ts's own
// `if (env.NODE_ENV !== "test")` bootstrap guard. Dedicated rate-limiter
// tests (test/middleware/rateLimiter.test.ts) opt into real enforcement
// behavior via an injected FAKE IRateLimiter, same DI pattern as
// IJobQueue/IEnsClient/IElectionContractClient - never a real Redis
// connection either way.
//
// TWO TIERS, per the design doc's scope decision:
// 1. `generalWriteLimiter` - mounted globally in app.ts, applies only to
//    POST/PUT/PATCH/DELETE (Section 24's literal "public write
//    endpoints"), skips GET/HEAD/OPTIONS entirely.
// 2. `authNonceOrSiweLimiter` - mounted directly on POST /auth/nonce and
//    POST /auth/siwe in auth.routes.ts specifically - the only two
//    endpoints in this backend reachable with zero authentication at all,
//    making them the actual brute-force/nonce-exhaustion target the
//    general limiter alone is too generous for. POST /auth/logout
//    deliberately does NOT get this stricter tier - see its own route's
//    "why no requireAuth" comment for the same idempotent-by-design
//    reasoning.
//
// FAILS OPEN on any infra error (logged loudly), never fails the request:
// a rate limiter is defense-in-depth, not a correctness requirement -
// Redis being briefly unreachable should degrade to "not rate limited
// right now", not take down every write endpoint in the API. Same
// philosophy as the Wallet module's ENS resolution being non-load-bearing,
// applied to a different kind of dependency.

import type { NextFunction, Request, Response } from "express";
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { getRedisConnection } from "../shared/redis.js";
import { logger } from "../shared/logger.js";
import { HttpError } from "../shared/httpError.js";
import { env } from "../config/env.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface LimiterConfig {
  keyPrefix: string;
  points: number;
  durationSeconds: number;
}

/** Thrown by an IRateLimiter's consume() when the key is over quota - library-agnostic, so fakes don't need to import rate-limiter-flexible at all. */
export class RateLimitExceededError extends Error {
  constructor(public readonly msBeforeNext: number) {
    super("Rate limit exceeded");
    this.name = "RateLimitExceededError";
  }
}

/**
 * Minimal seam over "a thing that can say yes/no to a key", same purpose
 * and pattern as IElectionContractClient/IEnsClient/IJobQueue elsewhere in
 * this codebase: lets tests inject a fake instead of requiring a real
 * Redis connection.
 */
export interface IRateLimiter {
  /** Resolves if under quota; rejects with RateLimitExceededError if not. Any other rejection is treated as an infra failure (fail open). */
  consume(key: string): Promise<void>;
}

class RedisRateLimiter implements IRateLimiter {
  private readonly limiter: RateLimiterRedis;

  constructor(config: LimiterConfig) {
    this.limiter = new RateLimiterRedis({
      storeClient: getRedisConnection(),
      keyPrefix: config.keyPrefix,
      points: config.points,
      duration: config.durationSeconds,
    });
  }

  async consume(key: string): Promise<void> {
    try {
      await this.limiter.consume(key);
    } catch (rejectionOrError) {
      if (rejectionOrError instanceof RateLimiterRes) {
        throw new RateLimitExceededError(rejectionOrError.msBeforeNext);
      }
      throw rejectionOrError; // real infra error - caller's fail-open logic handles it
    }
  }
}

/**
 * Always allows. Used automatically for every test file that doesn't
 * explicitly opt into real enforcement behavior - see this file's header
 * comment for why this default exists at all.
 */
class NoopRateLimiter implements IRateLimiter {
  async consume(): Promise<void> {
    // Deliberately empty - see class comment.
  }
}

function buildDefaultLimiter(config: LimiterConfig): IRateLimiter {
  return env.NODE_ENV === "test" ? new NoopRateLimiter() : new RedisRateLimiter(config);
}

interface Limiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  _setForTests: (fake: IRateLimiter | undefined) => void;
}

function createLimiter(config: LimiterConfig): Limiter {
  let current: IRateLimiter | undefined;

  function getCurrent(): IRateLimiter {
    current ??= buildDefaultLimiter(config);
    return current;
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    getCurrent()
      .consume(req.ip ?? "unknown")
      .then(() => next())
      .catch((err: unknown) => {
        if (err instanceof RateLimitExceededError) {
          res.setHeader("Retry-After", Math.ceil(err.msBeforeNext / 1000).toString());
          next(new HttpError(429, "RATE_LIMITED", "Too many requests. Please try again later."));
          return;
        }
        logger.error({ err, keyPrefix: config.keyPrefix }, "Rate limiter backend error; failing open");
        next();
      });
  }

  function _setForTests(fake: IRateLimiter | undefined): void {
    current = fake;
  }

  return { middleware, _setForTests };
}

const writeLimiter = createLimiter({
  keyPrefix: "rl-write",
  points: 30,
  durationSeconds: 15 * 60, // 15 minutes
});

/**
 * General write-endpoint limiter (Section 24's literal scope). Mounted
 * globally in app.ts; internally a no-op for GET/HEAD/OPTIONS so it's
 * safe to mount ahead of every router rather than repeating it per-route.
 */
export function generalWriteLimiter(req: Request, res: Response, next: NextFunction): void {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  writeLimiter.middleware(req, res, next);
}

/** Test-only seam. Never called from non-test code. */
export function _setGeneralWriteLimiterForTests(fake: IRateLimiter | undefined): void {
  writeLimiter._setForTests(fake);
}

const authLimiter = createLimiter({
  keyPrefix: "rl-auth",
  points: 10,
  durationSeconds: 10 * 60, // 10 minutes
});

/**
 * Stricter limiter for the two zero-auth endpoints (POST /auth/nonce,
 * POST /auth/siwe) - mounted directly on those routes in auth.routes.ts,
 * not globally. A separate limiter instance from generalWriteLimiter
 * (different keyPrefix, different quota) - the two are independent.
 */
export function authNonceOrSiweLimiter(req: Request, res: Response, next: NextFunction): void {
  authLimiter.middleware(req, res, next);
}

/** Test-only seam. Never called from non-test code. */
export function _setAuthNonceOrSiweLimiterForTests(fake: IRateLimiter | undefined): void {
  authLimiter._setForTests(fake);
}