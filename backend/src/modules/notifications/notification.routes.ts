// Notifications module routes. Mounted under /elections (same prefix as
// Election/Candidate/Voting's routers - see app.ts), giving
// POST /elections/:id/notifications/subscribe.
//
// AUTH: requireAuth, using res.locals.auth!.address as the wallet
// address to store - never a client-supplied address - same "own
// address only" convention as every other authenticated write endpoint
// in this codebase (e.g. candidate.routes.ts's setCandidateProfile,
// voting.routes.ts's hasVoted).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { subscribeToElectionNotifications } from "./notification.service.js";

export const notificationRouter = Router();

const electionIdParamSchema = z.object({
  id: z.coerce.number().int().nonnegative(),
});

const subscribeBodySchema = z.object({
  email: z.string().email(),
});

/**
 * @openapi
 * /elections/{id}/notifications/subscribe:
 *   post:
 *     summary: Opt in to an email notification when this election is finalized
 *     tags: [Notifications]
 *     responses:
 *       204:
 *         description: Subscribed (or preference updated).
 *       400:
 *         description: Invalid email.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: No election found with this id.
 */
notificationRouter.post(
  "/:id/notifications/subscribe",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = electionIdParamSchema.parse(req.params);
    const body = subscribeBodySchema.parse(req.body);
    // requireAuth guarantees res.locals.auth is set - see auth.middleware.ts.
    await subscribeToElectionNotifications({
      electionId: id,
      walletAddress: res.locals.auth!.address,
      email: body.email,
    });
    res.status(204).send();
  }),
);