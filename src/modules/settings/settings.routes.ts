import { Router } from "express";
import * as settingsController from "./settings.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { updateSettingsSchema } from "./settings.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.get("/", settingsController.get);
router.put("/", authGuard(Role.SUPER_ADMIN), validateSchema({ body: updateSettingsSchema }), settingsController.update);

export { router as SettingsRoutes };
