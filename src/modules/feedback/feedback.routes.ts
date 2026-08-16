import { Router } from "express";
import * as feedbackController from "./feedback.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { createFeedbackSchema, feedbackQuerySchema, feedbackIdParamSchema } from "./feedback.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post("/", validateSchema({ body: createFeedbackSchema }), feedbackController.submit);
router.get("/", authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER), validateSchema({ query: feedbackQuerySchema }), feedbackController.list);
router.get("/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER), validateSchema({ params: feedbackIdParamSchema }), feedbackController.getById);

export { router as FeedbackRoutes };
