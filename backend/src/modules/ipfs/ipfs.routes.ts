// IPFS module routes (architecture Section 7.1/20). Deliberately thin -
// request parsing/validation only, all real logic in ipfs.service.ts -
// same convention as every other domain module's routes file.
//
// SINGLE ENDPOINT, BY DESIGN: POST /ipfs/upload. This exists so an
// admin's candidate-photo upload can go through the backend (which holds
// IPFS_API_KEY/IPFS_API_SECRET) rather than the browser needing its own
// pinning-provider credentials. The resulting CID is handed back to the
// frontend, which then puts it into the `addCandidate` transaction it
// sends directly to the chain from the admin's own wallet - same
// wallet-direct pattern as every other on-chain write in this project
// (see candidate.service.ts's header comment). This module never touches
// the chain itself.
//
// AUTHORIZATION: gated by requireAuth AND requireRole(ELECTION_ADMINISTRATOR_ROLE)
// (HANDOFF.md's "Newly discovered pre-frontend items", item 1 - real
// on-chain-role enforcement, not just requireAuth). Uploading an image to
// IPFS still has no on-chain effect by itself - a rejected caller here
// would only ever have produced an orphaned pin, never registered a real
// candidate - but there was no on-chain revert safety net for this
// endpoint at all (it never touches the chain), so requireAuth alone
// really did mean "any logged-in wallet can spend the backend's IPFS
// quota," not just a defense-in-depth gap.

import { Router, type NextFunction, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../shared/httpError.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireRole } from "../auth/auth.roles.middleware.js";
import { ELECTION_ADMINISTRATOR_ROLE } from "../blockchain/index.js";
import { getIpfsClient, uploadCandidateImage } from "./index.js";
import { MAX_IMAGE_SIZE_BYTES } from "./ipfs.types.js";

export const ipfsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 },
});

/**
 * Wraps multer's own middleware so a MulterError (e.g. the file exceeds
 * `limits.fileSize`) becomes a normal 400 HttpError through the shared
 * errorHandler.ts, instead of falling through to that handler's generic
 * "any other Error is a 500" branch - same reasoning as
 * candidate.service.ts wrapping BlockchainError, or election.service.ts
 * wrapping the blockchain module's other errors, into HttpError at the
 * point where a lower-level error becomes a domain-meaningful one.
 */
function singleImageUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("image")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      next(new HttpError(400, "IMAGE_TOO_LARGE", `Image exceeds the maximum allowed size of ${MAX_IMAGE_SIZE_BYTES} bytes.`));
      return;
    }
    if (err instanceof MulterError) {
      next(new HttpError(400, "IMAGE_UPLOAD_ERROR", err.message));
      return;
    }
    next(err);
  });
}

/**
 * @openapi
 * /ipfs/upload:
 *   post:
 *     summary: Upload a candidate image to IPFS, returning its CID and a resolved gateway URL
 *     tags: [Ipfs]
 *     responses:
 *       200:
 *         description: Upload succeeded.
 *       400:
 *         description: No image provided, unsupported type, or file too large.
 *       401:
 *         description: Authentication required.
 *       502:
 *         description: The IPFS pinning provider rejected or failed the upload.
 */
ipfsRouter.post(
  "/upload",
  asyncHandler(requireAuth),
  asyncHandler(requireRole(ELECTION_ADMINISTRATOR_ROLE)),
  singleImageUpload,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new HttpError(400, "IMAGE_REQUIRED", "An image file is required under the \"image\" form field.");
    }
    const result = await uploadCandidateImage(req.file, getIpfsClient());
    res.status(201).json(result);
  }),
);