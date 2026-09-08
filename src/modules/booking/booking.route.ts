import { Router } from "express";
import * as bookingController from "./booking.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { Role } from "../../../generated/prisma/enums";
import {
  createBookingSchema,
  updateBookingSchema,
  bookingQuerySchema,
  bookingReportQuerySchema,
  bookingIdSchema,
  paxAdjustSchema,
  actualPaxSchema,
  bookingStatusSchema,
} from "./booking.validation";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER, Role.COO, Role.MD));

/** MD (Managing Director) is read-only: every mutation below re-guards without MD. */
const writeGuard = authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER, Role.COO);

// Dashboard / calendar / warnings / reports (must precede /:id)
router.get("/dashboard", bookingController.dashboard);
router.get("/upcoming", bookingController.upcoming);
router.get("/calendar", bookingController.calendar);
router.get("/warnings", bookingController.warnings);
router.get("/reports/summary", validateSchema({ query: bookingReportQuerySchema }), bookingController.report);
router.get("/reports/daily", bookingController.dailyReport);
router.get("/reports/weekly", bookingController.weeklyReport);
router.get("/reports/monthly", bookingController.monthlyReport);
router.get("/export/excel", validateSchema({ query: bookingReportQuerySchema }), bookingController.exportExcel);

// CRUD
router.post("/", writeGuard, validateSchema({ body: createBookingSchema }), bookingController.create);
router.get("/", validateSchema({ query: bookingQuerySchema }), bookingController.list);
router.get("/:id", validateSchema({ params: bookingIdSchema }), bookingController.getById);
router.patch("/:id", writeGuard, validateSchema({ params: bookingIdSchema, body: updateBookingSchema }), bookingController.update);
router.delete("/:id", writeGuard, validateSchema({ params: bookingIdSchema }), bookingController.remove);

// Pax + status + audit
router.post("/:id/pax-adjustments", writeGuard, validateSchema({ params: bookingIdSchema, body: paxAdjustSchema }), bookingController.adjustPax);
router.get("/:id/pax-history", validateSchema({ params: bookingIdSchema }), bookingController.paxHistory);
router.patch("/:id/actual-pax", writeGuard, validateSchema({ params: bookingIdSchema, body: actualPaxSchema }), bookingController.setActualPax);
router.patch("/:id/status", writeGuard, validateSchema({ params: bookingIdSchema, body: bookingStatusSchema }), bookingController.setStatus);
router.get("/:id/status-history", validateSchema({ params: bookingIdSchema }), bookingController.statusHistory);
router.get("/:id/timeline", validateSchema({ params: bookingIdSchema }), bookingController.timeline);

export { router as BookingRoutes };
