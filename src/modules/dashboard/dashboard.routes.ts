import { Router } from "express";
import * as dashboardController from "./dashboard.controller";
import { authGuard } from "../../middleware/auth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/summary", dashboardController.summary);
router.get("/recent-feedback", dashboardController.recentFeedback);
router.get("/branch-ranking", authGuard(Role.SUPER_ADMIN, Role.ADMIN), dashboardController.branchRanking);
router.get("/negative-feedback", dashboardController.negativeFeedback);

export { router as DashboardRoutes };
