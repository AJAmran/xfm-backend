import { Router } from "express";
import * as branchController from "./branch.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { createBranchSchema, updateBranchSchema, branchQuerySchema, branchStatusSchema } from "./branch.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.get("/active", branchController.listActive);router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN));

router.post("/",  validateSchema({ body: createBranchSchema }), branchController.create);
router.get("/", validateSchema({ query: branchQuerySchema }), branchController.list);
router.get("/:id", branchController.getById);
router.put("/:id", validateSchema({ body: updateBranchSchema }), branchController.update);
router.patch("/:id/status", validateSchema({ body: branchStatusSchema }), branchController.updateStatus);
router.delete("/:id", branchController.remove);

export { router as BranchRoutes };
