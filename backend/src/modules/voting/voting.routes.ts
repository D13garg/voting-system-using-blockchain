// Voting module routes (architecture Section 7.3 lists
// "GET /elections/:id/results" explicitly; "GET /elections/:id/has-voted"
// is a necessary elaboration for the frontend to know whether to show a
// ballot or a "you already voted" state - see voting.service.ts's header
// comment and HANDOFF.md for the design-fork discussion).
//
// Both routes take the on-chain electionId directly (a number), not
// Election module's Mongo draft id - see voting.types.ts's header
// comment on why this module has no concept of a draft.
//
// Deliberately thin, same principle as every other module's routes file.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { getElectionContractClient } from "../blockchain/index.js";
import { getElectionResults, hasVoted } from "./voting.service.js";
import type { VoteStatus } from "./voting.types.js";

export const votingRouter = Router();

const electionIdParamSchema = z.object({
  id: z.coerce.number().int().nonnegative(),
});

/**
 * @openapi
 * /elections/{id}/results:
 *   get:
 *     summary: Live per-candidate vote tally for an on-chain election
 *     tags: [Voting]
 *     responses:
 *       200:
 *         description: Tally results.
 *       404:
 *         description: No on-chain election with that id.
 */
votingRouter.get(
  "/:id/results",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = electionIdParamSchema.parse(req.params);
    const results = await getElectionResults(id, getElectionContractClient());
    res.status(200).json({ results });
  }),
);

/**
 * @openapi
 * /elections/{id}/has-voted:
 *   get:
 *     summary: Whether the currently authenticated wallet has already voted in this election
 *     tags: [Voting]
 *     responses:
 *       200:
 *         description: Vote status for the authenticated wallet.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: No on-chain election with that id.
 */
votingRouter.get(
  "/:id/has-voted",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = electionIdParamSchema.parse(req.params);
    // requireAuth guarantees res.locals.auth is set - see auth.middleware.ts.
    const address = res.locals.auth!.address;
    const voted = await hasVoted(id, address as `0x${string}`, getElectionContractClient());
    const status: VoteStatus = { electionId: id, address, hasVoted: voted };
    res.status(200).json({ status });
  }),
);