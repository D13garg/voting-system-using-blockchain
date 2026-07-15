// requireRole - real on-chain AccessControl role enforcement for
// admin-facing write endpoints (HANDOFF.md's "Newly discovered
// pre-frontend items", item 1). Deliberately a separate file/export from
// auth.middleware.ts's requireAuth, not folded into it - requireAuth's
// own header comment already explains why role checks don't belong
// there: they are on-chain facts that "can change independently of the
// session's lifetime, so they must be checked live against the chain...
// at the point of use," never baked into the session. This module is
// that point of use. It composes with requireAuth (must run after it -
// reads res.locals.auth, throws if absent, which should only happen if a
// route wires requireRole without requireAuth first).
//
// CONTRACT CHOICE (approved forked decision): role state is per-contract
// (AccessRoles.sol's constructor runs once per deployment - Election and
// VoterRegistry do not share AccessControl storage, see
// IElectionContractClient.hasRole's doc comment). For endpoints not tied
// to one specific contract's write path (registration approve/reject,
// candidate profile edits, election draft/link), this checks BOTH
// contracts and requires the role on AT LEAST ONE (an OR, not an AND) -
// the most permissive reading, chosen to tolerate the two contracts'
// role state drifting apart over time (e.g. an address granted the role
// on Election but not yet re-granted it on VoterRegistry after a
// deliberate rotation) rather than requiring perfect symmetry between
// two independently-managed AccessControl instances.
//
// CACHING (approved forked decision, Claude's call): deliberately NOT
// cached, unlike the Wallet module's ENS TtlCache. That cache is for a
// pure display nicety where a stale value for up to an hour is harmless;
// this is a security-relevant authorization check, and requireAuth's own
// header comment already states the exact governing principle - on-chain
// role facts "must be checked live against the chain... at the point of
// use." Caching a role grant/revocation for even a short window would
// directly contradict that stated principle for the one class of check
// it was written to describe. The two RPC reads this adds per admin
// write are bounded by the existing generalWriteLimiter (rate-limiting
// gap #3, already closed) - the write endpoints this middleware gates
// are exactly the ones that limiter already covers, so this doesn't open
// a new unbounded-RPC-call surface.

import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../shared/httpError.js";
import { getElectionContractClient, getVoterRegistryContractClient } from "../blockchain/index.js";

/**
 * The actual OR-across-both-contracts check (see this file's header
 * comment for why OR, not AND). Extracted so it has exactly one
 * implementation: `requireRoleMiddleware` below (enforcement, throws on
 * failure) and `GET /admin/me/role` (admin.routes.ts — a plain read, for
 * the frontend's RoleGuard to decide what to render) both call this
 * rather than each re-implementing the Promise.all/OR logic separately.
 */
export async function checkHasRoleOnEitherContract(role: `0x${string}`, account: `0x${string}`): Promise<boolean> {
  const [hasRoleOnElection, hasRoleOnVoterRegistry] = await Promise.all([
    getElectionContractClient().hasRole(role, account),
    getVoterRegistryContractClient().hasRole(role, account),
  ]);
  return hasRoleOnElection || hasRoleOnVoterRegistry;
}

export function requireRole(role: `0x${string}`) {
  return async function requireRoleMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = res.locals.auth;
      if (!auth) {
        // Should never happen if requireRole is wired after requireAuth,
        // same defensive-but-real-error convention as other middleware
        // in this codebase relying on an earlier middleware's contract.
        throw new HttpError(401, "UNAUTHENTICATED", "A valid session is required for this request.");
      }
      const account = auth.address as `0x${string}`;

      const hasRoleOnEitherContract = await checkHasRoleOnEitherContract(role, account);
      if (!hasRoleOnEitherContract) {
        throw new HttpError(
          403,
          "FORBIDDEN_ROLE",
          "This wallet does not hold the required on-chain role for this action.",
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}