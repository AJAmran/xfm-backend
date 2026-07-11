import { Router } from "express";
import * as analyticsController from "./analytics.controller";
import { authGuard } from "../../middleware/auth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/ratings", analyticsController.ratings);
router.get("/branches", authGuard(Role.SUPER_ADMIN, Role.ADMIN), analyticsController.branches);
router.get("/monthly", analyticsController.monthly);
router.get("/satisfaction", analyticsController.satisfaction);

export { router as AnalyticsRoutes };
