import { Router } from "express";
import * as reportsController from "./reports.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import {
  reportsQuerySchema,
  reportsBranchQuerySchema,
  reportsExcelQuerySchema,
  reportsInventoryExcelQuerySchema,
} from "./reports.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/daily", validateSchema({ query: reportsQuerySchema }), reportsController.daily);
router.get("/weekly", validateSchema({ query: reportsQuerySchema }), reportsController.weekly);
router.get("/monthly", validateSchema({ query: reportsQuerySchema }), reportsController.monthly);
router.get("/branch", validateSchema({ query: reportsBranchQuerySchema }), reportsController.branch);
router.get("/export/excel", validateSchema({ query: reportsExcelQuerySchema }), reportsController.exportExcel);
router.get("/export/excel/manager-reports", validateSchema({ query: reportsExcelQuerySchema }), reportsController.exportManagerReportsExcel);
router.get("/export/excel/guest-offers/discounts", validateSchema({ query: reportsExcelQuerySchema }), reportsController.exportDiscountLogsExcel);
router.get("/export/excel/guest-offers/entertainments", validateSchema({ query: reportsExcelQuerySchema }), reportsController.exportEntertainmentLogsExcel);
router.get("/export/excel/inventory", validateSchema({ query: reportsInventoryExcelQuerySchema }), reportsController.exportInventoryExcel);
router.get("/export/pdf", reportsController.exportPdf);

export { router as ReportsRoutes };
