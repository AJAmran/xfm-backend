import { Router } from "express";
import * as documentController from "./document.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { Role } from "../../../generated/prisma/enums";
import { approvalQuerySchema } from "./document.validation";

const router = Router();

/**
 * Approval inbox.
 *
 * Mounted at `/api/v1/approvals` so the endpoint names match the module
 * specification while sharing the document module's implementation.
 */
router.use(
  authGuard(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.DIRECTOR,
    Role.MANAGER,
    Role.BRANCH_MANAGER,
    Role.COO,
    Role.MD,
  ),
);

router.get("/pending", validateSchema({ query: approvalQuerySchema }), documentController.pending);
router.get("/history", validateSchema({ query: approvalQuerySchema }), documentController.history);
router.post("/validate-sequence", documentController.validateSequence);

export { router as ApprovalRoutes };