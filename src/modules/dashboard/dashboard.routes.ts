import { Router } from "express";
import * as dashboardController from "./dashboard.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { dashboardQuerySchema } from "./dashboard.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/summary", validateSchema({ query: dashboardQuerySchema }), dashboardController.summary);
router.get("/recent-feedback", validateSchema({ query: dashboardQuerySchema }), dashboardController.recentFeedback);
router.get("/branch-ranking", authGuard(Role.SUPER_ADMIN, Role.ADMIN), dashboardController.branchRanking);
router.get("/negative-feedback", validateSchema({ query: dashboardQuerySchema }), dashboardController.negativeFeedback);

export { router as DashboardRoutes };
