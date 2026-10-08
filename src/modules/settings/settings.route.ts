import { Router } from "express";
import * as settingsController from "./settings.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { updateSettingsSchema } from "./settings.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

// Any authenticated role may read settings (the dashboard renders company name
// and contact details from them). This route was previously unguarded, which
// exposed the company profile and the document policy JSON to anonymous
// callers. Writes stay SUPER_ADMIN-only.
router.get("/", authGuard(), settingsController.get);
router.put("/", authGuard(Role.SUPER_ADMIN), validateSchema({ body: updateSettingsSchema }), settingsController.update);

export { router as SettingsRoutes };
