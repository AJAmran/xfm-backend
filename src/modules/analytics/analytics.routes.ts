import { Router } from "express";
import * as analyticsController from "./analytics.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { analyticsQuerySchema } from "./analytics.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/ratings", validateSchema({ query: analyticsQuerySchema }), analyticsController.ratings);
router.get("/branches", authGuard(Role.SUPER_ADMIN, Role.ADMIN), analyticsController.branches);
router.get("/monthly", validateSchema({ query: analyticsQuerySchema }), analyticsController.monthly);
router.get("/satisfaction", validateSchema({ query: analyticsQuerySchema }), analyticsController.satisfaction);

export { router as AnalyticsRoutes };
