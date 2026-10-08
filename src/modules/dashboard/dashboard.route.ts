import { Router } from "express";
import * as dashboardController from "./dashboard.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { dashboardQuerySchema } from "./dashboard.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

// Corporate management (DIRECTOR / MANAGER) is global with no branch, so it can
// read the cross-branch overview but not the branch ranking, which is scoped to
// the administration/executive tier.
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

router.get("/summary", validateSchema({ query: dashboardQuerySchema }), dashboardController.summary);
router.get("/recent-feedback", validateSchema({ query: dashboardQuerySchema }), dashboardController.recentFeedback);
router.get("/branch-ranking", authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.COO, Role.MD), validateSchema({ query: dashboardQuerySchema }), dashboardController.branchRanking);
router.get("/negative-feedback", validateSchema({ query: dashboardQuerySchema }), dashboardController.negativeFeedback);
router.get("/operational-widgets", dashboardController.operationalWidgets);

export { router as DashboardRoutes };
