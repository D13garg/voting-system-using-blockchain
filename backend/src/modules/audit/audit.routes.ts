// Audit module routes (architecture Section 17's AuditLog work). Mounted
// at /admin in app.ts, same convention as admin.routes.ts's adminRouter.
//
// AUTHORIZATION: same approved design fork as every other admin-only
// endpoint in this codebase (admin.routes.ts, notification.routes.ts) -
// gated by requireAuth only (any logged-in wallet), not a real
// ELECTION_ADMINISTRATOR_ROLE/SYSTEM_ADMINISTRATOR_ROLE check. Harmless
// for the same reason: reading audit history has no on-chain effect, and
// this is exactly the kind of data a real on-chain-role mirror (the TODO
// noted in admin.service.ts) would eventually gate more tightly. Not
// tightened here, to keep this consistent with the rest of the module
// rather than inventing a stricter rule for one endpoint.
//
// Deliberately thin - request parsing/validation only, all real logic in
// audit.service.ts.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { listAuditLogs } from "./audit.service.js";

export const auditRouter = Router();

const listQuerySchema = z.object({
  category: z
    .enum([
      "ROLE_GRANTED",
      "ROLE_REVOKED",
      "ELECTION_CREATED",
      "ELECTION_FINALIZED",
      "REGISTRATION_APPROVED",
      "REGISTRATION_REJECTED",
    ])
    .optional(),
  electionId: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
});

/**
 * @openapi
 * /admin/audit-logs:
 *   get:
 *     summary: List audit log entries (role grants/revocations, election state transitions, registration decisions), newest first
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Paginated audit log entries.
 *       401:
 *         description: Authentication required.
 */
auditRouter.get(
  "/audit-logs",
  asyncHandler(requireAuth),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, electionId, page, limit } = listQuerySchema.parse(req.query);
    const result = await listAuditLogs({ category, electionId, page, limit });
    res.status(200).json(result);
  }),
);
