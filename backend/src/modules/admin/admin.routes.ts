// Admin module routes (architecture Section 7.3: "POST
// /voters/register-request", "GET /admin/registration-requests", "POST
// /admin/registration-requests/:id/approve" are explicit in the spec).
// A ".../reject" sibling and "GET /voters/me/registration/:electionId"
// are a necessary elaboration, not scope creep, same pattern as every
// other module's routes file - a review workflow needs a "no" as well as
// a "yes", and Section 13's "Wallet User... view personalized
// eligibility" needs a way to ask "what's my own status" (see
// auth.middleware.ts's own header comment, which already anticipated
// this as an authenticated "own receipts/history"-style concern).
//
// Deliberately thin - request parsing/validation only, all real logic in
// admin.service.ts.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  getMyRegistrationStatus,
  listRegistrationRequests,
  reviewRegistrationRequest,
  submitRegistrationRequest,
} from "./admin.service.js";

export const votersRouter = Router();
export const adminRouter = Router();

const submitRequestBodySchema = z.object({
  electionId: z.number().int().nonnegative(),
});

const electionIdParamSchema = z.object({ electionId: z.coerce.number().int().nonnegative() });
const requestIdParamSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

/**
 * @openapi
 * /voters/register-request:
 *   post:
 *     summary: Submit a registration request for an election
 *     tags: [Admin]
 *     responses:
 *       201:
 *         description: Request submitted.
 *       401:
 *         description: Authentication required.
 *       409:
 *         description: A pending or approved request already exists for this wallet and election.
 */
votersRouter.post(
  "/register-request",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const body = submitRequestBodySchema.parse(req.body);
    const doc = await submitRegistrationRequest({
      electionId: body.electionId,
      voterAddress: res.locals.auth!.address,
    });
    res.status(201).json({
      request: {
        id: doc._id.toString(),
        electionId: doc.electionId,
        voterAddress: doc.voterAddress,
        status: doc.status,
        requestedAt: doc.createdAt.toISOString(),
      },
    });
  }),
);

/**
 * @openapi
 * /voters/me/registration/{electionId}:
 *   get:
 *     summary: The authenticated wallet's own registration status for an election
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Current status (or "not_requested" if no request exists).
 *       401:
 *         description: Authentication required.
 */
votersRouter.get(
  "/me/registration/:electionId",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { electionId } = electionIdParamSchema.parse(req.params);
    const status = await getMyRegistrationStatus(electionId, res.locals.auth!.address);
    res.status(200).json({ status });
  }),
);

/**
 * @openapi
 * /admin/registration-requests:
 *   get:
 *     summary: List registration requests, optionally filtered by status
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: List of requests, merged with a mirrored on-chain confirmation check.
 *       401:
 *         description: Authentication required.
 */
adminRouter.get(
  "/registration-requests",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = listQuerySchema.parse(req.query);
    const requests = await listRegistrationRequests({ status });
    res.status(200).json({ requests });
  }),
);

/**
 * @openapi
 * /admin/registration-requests/{id}/approve:
 *   post:
 *     summary: Approve a pending registration request (records the decision only - the admin's own wallet still submits registerVoter() separately)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Request approved.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Request not found.
 *       409:
 *         description: Request was already reviewed.
 */
adminRouter.post(
  "/registration-requests/:id/approve",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = requestIdParamSchema.parse(req.params);
    const request = await reviewRegistrationRequest({
      requestId: id,
      decision: "approved",
      reviewedBy: res.locals.auth!.address,
    });
    res.status(200).json({ request });
  }),
);

/**
 * @openapi
 * /admin/registration-requests/{id}/reject:
 *   post:
 *     summary: Reject a pending registration request
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Request rejected.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Request not found.
 *       409:
 *         description: Request was already reviewed.
 */
adminRouter.post(
  "/registration-requests/:id/reject",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = requestIdParamSchema.parse(req.params);
    const request = await reviewRegistrationRequest({
      requestId: id,
      decision: "rejected",
      reviewedBy: res.locals.auth!.address,
    });
    res.status(200).json({ request });
  }),
);