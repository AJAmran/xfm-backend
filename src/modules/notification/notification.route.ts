import { Router } from "express";
import * as notificationController from "./notification.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { Role } from "../../../generated/prisma/enums";
import { notificationQuerySchema, notificationIdSchema } from "./notification.validation";

const router = Router();

// The corporate management tier is included: an approver with no notification
// bell has no way to learn that a document is waiting for them.
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

router.get("/", validateSchema({ query: notificationQuerySchema }), notificationController.list);
router.get("/unread-count", notificationController.unreadCount);
router.patch("/:id/read", validateSchema({ params: notificationIdSchema }), notificationController.markRead);
router.delete("/:id", validateSchema({ params: notificationIdSchema }), notificationController.deleteOne);
router.post("/read-all", notificationController.markAllRead);

export { router as NotificationRoutes };
