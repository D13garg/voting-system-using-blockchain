// Candidate module routes (architecture Section 7.1: "candidate
// metadata, bios, IPFS CID references"). Same on-chain-electionId-space
// convention as Voting's routes (:id here is the numeric on-chain
// electionId, not Election module's Mongo draft id) - candidates only
// exist once on-chain, so there's no draft-id indirection to resolve,
// same reasoning as voting.routes.ts's header comment.
//
// Deliberately thin - request parsing/validation only, all real logic in
// candidate.service.ts.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../auth/auth.roles.middleware.js";
import { ELECTION_ADMINISTRATOR_ROLE, getElectionContractClient } from "../blockchain/index.js";
import { listCandidates, setCandidateProfile } from "./candidate.service.js";

export const candidateRouter = Router();

const electionIdParamSchema = z.object({ id: z.coerce.number().int().nonnegative() });
const candidateParamsSchema = z.object({
  id: z.coerce.number().int().nonnegative(),
  candidateId: z.coerce.number().int().nonnegative(),
});
const setProfileBodySchema = z.object({
  bio: z.string().min(1),
});

/**
 * @openapi
 * /elections/{id}/candidates:
 *   get:
 *     summary: List candidates for an election, on-chain identity merged with off-chain bios
 *     tags: [Candidate]
 *     responses:
 *       200:
 *         description: List of candidates.
 *       404:
 *         description: No election found with that on-chain id.
 */
candidateRouter.get(
  "/:id/candidates",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = electionIdParamSchema.parse(req.params);
    const candidates = await listCandidates(id);
    res.status(200).json({ candidates });
  }),
);

/**
 * @openapi
 * /elections/{id}/candidates/{candidateId}/profile:
 *   put:
 *     summary: Set or update a candidate's off-chain bio (admin-only; blocked once voting has started)
 *     tags: [Candidate]
 *     responses:
 *       200:
 *         description: Profile updated.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Election or candidate not found on-chain.
 *       409:
 *         description: Voting has already started for this election; profiles are locked.
 */
candidateRouter.put(
  "/:id/candidates/:candidateId/profile",
  asyncHandler(requireAuth),
  asyncHandler(requireRole(ELECTION_ADMINISTRATOR_ROLE)),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, candidateId } = candidateParamsSchema.parse(req.params);
    const body = setProfileBodySchema.parse(req.body);
    const candidate = await setCandidateProfile(
      { electionId: id, candidateId, bio: body.bio, updatedBy: res.locals.auth!.address },
      getElectionContractClient(),
    );
    res.status(200).json({ candidate });
  }),
);