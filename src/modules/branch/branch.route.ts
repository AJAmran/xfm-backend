import { Router } from "express";
import * as branchController from "./branch.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { createBranchSchema, updateBranchSchema, branchQuerySchema, branchStatusSchema } from "./branch.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.get("/active", branchController.listActive);

// Reads are open to executives (all-branch reports/filters); all writes
// stay with SUPER_ADMIN / ADMIN only.
router.get("/", authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.COO, Role.MD), validateSchema({ query: branchQuerySchema }), branchController.list);
router.get("/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.COO, Role.MD), branchController.getById);
router.post("/", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ body: createBranchSchema }), branchController.create);
router.put("/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ body: updateBranchSchema }), branchController.update);
router.patch("/:id/status", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ body: branchStatusSchema }), branchController.updateStatus);
router.delete("/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN), branchController.remove);

export { router as BranchRoutes };
