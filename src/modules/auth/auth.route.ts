import { Router } from "express";
import * as authController from "./auth.controller";
import { authGuard } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";
import { Role } from "../../../generated/prisma/enums";
import { validateSchema } from "../../middleware/validation";
import { loginValidationSchema } from "./auth.validation";

const route = Router();

route.post("/login", authLimiter, validateSchema({ body: loginValidationSchema }), authController.login);
route.post("/refresh-token", authController.refreshToken);
route.post("/logout", authController.logout);
route.get("/me", authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER), authController.me);

export const AuthRoutes = route;
