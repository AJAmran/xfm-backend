import { Router } from "express";
import * as userController from "./user.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { createUserSchema, updateUserSchema, userQuerySchema, userStatusSchema, userIdParamSchema } from "./user.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN));

router.post("/", validateSchema({ body: createUserSchema }), userController.create);
router.get("/", validateSchema({ query: userQuerySchema }), userController.list);
router.get("/:id", validateSchema({ params: userIdParamSchema }), userController.getById);
router.put("/:id", validateSchema({ params: userIdParamSchema, body: updateUserSchema }), userController.update);
router.patch("/:id/status", validateSchema({ params: userIdParamSchema, body: userStatusSchema }), userController.updateStatus);
router.delete("/:id", validateSchema({ params: userIdParamSchema }), userController.remove);

export { router as UserRoutes };
