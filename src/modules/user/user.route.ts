import { Router } from "express";
import * as userController from "./user.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { createUserSchema, updateUserSchema, userQuerySchema, userStatusSchema } from "./user.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN));

router.post("/", validateSchema({ body: createUserSchema }), userController.create);
router.get("/", validateSchema({ query: userQuerySchema }), userController.list);
router.get("/:id", userController.getById);
router.put("/:id", validateSchema({ body: updateUserSchema }), userController.update);
router.patch("/:id/status", validateSchema({ body: userStatusSchema }), userController.updateStatus);
router.delete("/:id", userController.remove);

export { router as UserRoutes };
