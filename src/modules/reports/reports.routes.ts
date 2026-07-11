import { Router } from "express";
import * as reportsController from "./reports.controller";
import { authGuard } from "../../middleware/auth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/daily", reportsController.daily);
router.get("/weekly", reportsController.weekly);
router.get("/monthly", reportsController.monthly);
router.get("/branch", reportsController.branch);
router.get("/export/excel", reportsController.exportExcel);
router.get("/export/pdf", reportsController.exportPdf);

export { router as ReportsRoutes };
