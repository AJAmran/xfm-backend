import { Router } from "express";
import * as reportsController from "./reports.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { reportsQuerySchema, reportsBranchQuerySchema, reportsExcelQuerySchema } from "./reports.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/daily", validateSchema({ query: reportsQuerySchema }), reportsController.daily);
router.get("/weekly", validateSchema({ query: reportsQuerySchema }), reportsController.weekly);
router.get("/monthly", validateSchema({ query: reportsQuerySchema }), reportsController.monthly);
router.get("/branch", validateSchema({ query: reportsBranchQuerySchema }), reportsController.branch);
router.get("/export/excel", validateSchema({ query: reportsExcelQuerySchema }), reportsController.exportExcel);
router.get("/export/pdf", reportsController.exportPdf);

export { router as ReportsRoutes };
