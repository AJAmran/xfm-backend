import { Router } from "express";
import * as guestOfferController from "./guest-offer.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { Role } from "../../../generated/prisma/enums";
import {
  guestDiscountCreateSchema,
  guestDiscountUpdateSchema,
  guestEntertainmentCreateSchema,
  guestEntertainmentUpdateSchema,
  approvalStatusSchema,
  guestOfferQuerySchema,
  guestOfferIdSchema,
} from "./guest-offer.validation";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER, Role.COO, Role.MD));

/** MD (Managing Director) is read-only: mutations re-guard without MD. */
const writeGuard = authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER, Role.COO);
/** Approvals: executives mean COO only (MD is view-only). */
const approveGuard = authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.COO);

router.get("/summary", validateSchema({ query: guestOfferQuerySchema }), guestOfferController.summary);

router.post("/discounts", writeGuard, validateSchema({ body: guestDiscountCreateSchema }), guestOfferController.createDiscount);
router.get("/discounts", validateSchema({ query: guestOfferQuerySchema }), guestOfferController.listDiscounts);
router.get("/discounts/:id", validateSchema({ params: guestOfferIdSchema }), guestOfferController.getDiscountById);
router.patch("/discounts/:id", writeGuard, validateSchema({ params: guestOfferIdSchema, body: guestDiscountUpdateSchema }), guestOfferController.updateDiscount);
router.patch("/discounts/:id/approval", approveGuard, validateSchema({ params: guestOfferIdSchema, body: approvalStatusSchema }), guestOfferController.setDiscountApproval);
router.delete("/discounts/:id", writeGuard, validateSchema({ params: guestOfferIdSchema }), guestOfferController.removeDiscount);

router.post("/entertainments", writeGuard, validateSchema({ body: guestEntertainmentCreateSchema }), guestOfferController.createEntertainment);
router.get("/entertainments", validateSchema({ query: guestOfferQuerySchema }), guestOfferController.listEntertainments);
router.get("/entertainments/:id", validateSchema({ params: guestOfferIdSchema }), guestOfferController.getEntertainmentById);
router.patch("/entertainments/:id", writeGuard, validateSchema({ params: guestOfferIdSchema, body: guestEntertainmentUpdateSchema }), guestOfferController.updateEntertainment);
router.patch("/entertainments/:id/approval", approveGuard, validateSchema({ params: guestOfferIdSchema, body: approvalStatusSchema }), guestOfferController.setEntertainmentApproval);
router.delete("/entertainments/:id", writeGuard, validateSchema({ params: guestOfferIdSchema }), guestOfferController.removeEntertainment);

export { router as GuestOfferRoutes };
