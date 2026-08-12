import { Router } from "express";
import * as managerReportController from "./manager-report.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { Role } from "../../../generated/prisma/enums";
import {
  createManagerReportSchema,
  updateManagerReportSchema,
  managerReportQuerySchema,
  managerReportIdSchema,
  approvalStatusSchema,
  createManagerReportCommentSchema,
} from "./manager-report.validation";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.post("/", validateSchema({ body: createManagerReportSchema }), managerReportController.create);
router.get("/", validateSchema({ query: managerReportQuerySchema }), managerReportController.list);
router.get("/summary", managerReportController.summary);
router.get("/:id/comments", validateSchema({ params: managerReportIdSchema }), managerReportController.getComments);
router.post("/:id/comments", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: managerReportIdSchema, body: createManagerReportCommentSchema }), managerReportController.addComment);
router.get("/:id", validateSchema({ params: managerReportIdSchema }), managerReportController.getById);
router.patch("/:id", validateSchema({ params: managerReportIdSchema, body: updateManagerReportSchema }), managerReportController.update);
router.patch("/:id/approval", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: managerReportIdSchema, body: approvalStatusSchema }), managerReportController.setApproval);
router.delete("/:id", validateSchema({ params: managerReportIdSchema }), managerReportController.remove);

export { router as ManagerReportRoutes };
