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
import {
  subscribeToElectionNotifications,
  subscribeToElectionWebhook,
  subscribeToElectionStartReminders,
} from "./notification.service.js";

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

const webhookSubscribeBodySchema = z.object({
  url: z.string().url(),
});

/**
 * @openapi
 * /elections/{id}/notifications/webhook-subscribe:
 *   post:
 *     summary: Opt in to a signed webhook POST when this election is finalized
 *     description: >
 *       A separate subscription from the email channel (gap #4's approved
 *       forked decision) - its own model, its own dispatch queue. Returns
 *       an HMAC-SHA256 secret used to sign every delivered payload
 *       (X-Webhook-Signature header) - shown only in this response, store
 *       it now. Re-subscribing the same election rotates the secret.
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Subscribed (or URL/secret rotated). Body contains the signing secret.
 *       400:
 *         description: Invalid URL.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: No election found with this id.
 */
notificationRouter.post(
  "/:id/notifications/webhook-subscribe",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = electionIdParamSchema.parse(req.params);
    const body = webhookSubscribeBodySchema.parse(req.body);
    // requireAuth guarantees res.locals.auth is set - see auth.middleware.ts.
    const { secret } = await subscribeToElectionWebhook({
      electionId: id,
      walletAddress: res.locals.auth!.address,
      url: body.url,
    });
    res.status(200).json({ secret });
  }),
);

/**
 * @openapi
 * /elections/{id}/notifications/start-reminder-subscribe:
 *   post:
 *     summary: Opt in to an advance "starting soon" reminder and a "voting is now open" notice
 *     description: >
 *       Gap #7's dedicated opt-in (approved forked decision) - flips
 *       wantsStartReminders on the caller's EXISTING email and/or webhook
 *       subscription(s) for this election. Does not register a new email
 *       or webhook URL itself; subscribe via /notifications/subscribe or
 *       /notifications/webhook-subscribe first.
 *     tags: [Notifications]
 *     responses:
 *       204:
 *         description: Start reminders enabled on every channel the caller was already subscribed on.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Caller has no email or webhook subscription for this election yet.
 */
notificationRouter.post(
  "/:id/notifications/start-reminder-subscribe",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = electionIdParamSchema.parse(req.params);
    // requireAuth guarantees res.locals.auth is set - see auth.middleware.ts.
    await subscribeToElectionStartReminders({
      electionId: id,
      walletAddress: res.locals.auth!.address,
    });
    res.status(204).send();
  }),
);