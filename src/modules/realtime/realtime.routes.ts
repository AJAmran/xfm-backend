import { Router } from "express";
import * as realtimeController from "./realtime.controller";
import { authGuard } from "../../middleware/auth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.get("/events", authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER), realtimeController.streamEvents);

export { router as RealtimeRoutes };