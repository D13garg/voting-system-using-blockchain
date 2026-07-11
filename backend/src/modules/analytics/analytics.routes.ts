// Analytics module routes (architecture Section 7.3's conceptual
// GET /analytics/:electionId endpoint).
//
// PUBLIC, NO requireAuth (deliberate, consistent with an existing
// convention rather than a new one): Voting's GET /elections/:id/results
// is already public for the same reason - every vote is itself public
// on-chain, so aggregate analytics derived from those same votes reveals
// nothing a public block explorer couldn't already show. This mirrors
// that, rather than introducing inconsistent gating for equivalent data.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { getAnalytics } from "./analytics.service.js";

export const analyticsRouter = Router();

const electionIdParamSchema = z.object({
  id: z.coerce.number().int().nonnegative(),
});

/**
 * @openapi
 * /analytics/{id}:
 *   get:
 *     summary: Get the analytics rollup for one election (vote tallies, turnout, participation over time)
 *     tags: [Analytics]
 *     responses:
 *       200:
 *         description: Rollup returned (zeroed if no votes indexed yet).
 *       404:
 *         description: No election found with this id.
 */
analyticsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = electionIdParamSchema.parse(req.params);
    const analytics = await getAnalytics(id);
    res.status(200).json({ analytics });
  }),
);