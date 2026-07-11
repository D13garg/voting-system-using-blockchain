// Election module routes (architecture Section 7.3: "GET /elections",
// "POST /elections/draft" are explicit in the spec). "GET /elections/:id"
// and "PATCH /elections/draft/:id/link-onchain" are a necessary
// elaboration, not scope creep - see election.service.ts's header
// comment for why the link-onchain step exists (the write-path
// architecture keeps the backend out of the actual createElection()
// transaction, so it has to be told the result some other way). See
// HANDOFF.md for the design-fork discussion these came out of.
//
// Deliberately thin, same principle as auth.routes.ts: request
// parsing/validation only, all real logic in election.service.ts.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { getElectionContractClient } from "../blockchain/index.js";
import { createDraft, getElectionById, linkOnChainElection, listElections } from "./election.service.js";

export const electionRouter = Router();

const createDraftBodySchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
});

const idParamSchema = z.object({ id: z.string().min(1) });

const linkOnChainBodySchema = z.object({
  electionId: z.number().int().nonnegative(),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte transaction hash"),
});

/**
 * @openapi
 * /elections:
 *   get:
 *     summary: List all elections known to this system (draft and on-chain), merged with live chain data
 *     tags: [Election]
 *     responses:
 *       200:
 *         description: List of elections.
 */
electionRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const elections = await listElections();
    res.status(200).json({ elections });
  }),
);

/**
 * @openapi
 * /elections/{id}:
 *   get:
 *     summary: Get a single election by its internal id, merged with live chain data if linked
 *     tags: [Election]
 *     responses:
 *       200:
 *         description: The election.
 *       404:
 *         description: No election found with that id.
 */
electionRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const election = await getElectionById(id);
    res.status(200).json({ election });
  }),
);

/**
 * @openapi
 * /elections/draft:
 *   post:
 *     summary: Create a new draft election (off-chain only, per Section 16's Draft state)
 *     tags: [Election]
 *     responses:
 *       201:
 *         description: Draft created.
 *       401:
 *         description: Authentication required.
 *       400:
 *         description: Malformed request body.
 */
electionRouter.post(
  "/draft",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createDraftBodySchema.parse(req.body);
    // requireAuth guarantees res.locals.auth is set - see auth.middleware.ts.
    const election = await createDraft({ ...body, createdBy: res.locals.auth!.address });
    res.status(201).json({ election });
  }),
);

/**
 * @openapi
 * /elections/draft/{id}/link-onchain:
 *   patch:
 *     summary: Record the on-chain electionId once the admin's own createElection() transaction has confirmed
 *     tags: [Election]
 *     responses:
 *       200:
 *         description: Draft linked.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Draft not found.
 *       409:
 *         description: Draft or on-chain election already linked to something else.
 *       422:
 *         description: electionId does not exist on-chain yet.
 */
electionRouter.patch(
  "/draft/:id/link-onchain",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const body = linkOnChainBodySchema.parse(req.body);
    const election = await linkOnChainElection(
      { draftId: id, ...body },
      getElectionContractClient(),
    );
    res.status(200).json({ election });
  }),
);