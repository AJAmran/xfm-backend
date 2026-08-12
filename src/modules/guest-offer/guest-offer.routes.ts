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

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

router.get("/summary", validateSchema({ query: guestOfferQuerySchema }), guestOfferController.summary);

router.post("/discounts", validateSchema({ body: guestDiscountCreateSchema }), guestOfferController.createDiscount);
router.get("/discounts", validateSchema({ query: guestOfferQuerySchema }), guestOfferController.listDiscounts);
router.get("/discounts/:id", validateSchema({ params: guestOfferIdSchema }), guestOfferController.getDiscountById);
router.patch("/discounts/:id", validateSchema({ params: guestOfferIdSchema, body: guestDiscountUpdateSchema }), guestOfferController.updateDiscount);
router.patch("/discounts/:id/approval", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: guestOfferIdSchema, body: approvalStatusSchema }), guestOfferController.setDiscountApproval);
router.delete("/discounts/:id", validateSchema({ params: guestOfferIdSchema }), guestOfferController.removeDiscount);

router.post("/entertainments", validateSchema({ body: guestEntertainmentCreateSchema }), guestOfferController.createEntertainment);
router.get("/entertainments", validateSchema({ query: guestOfferQuerySchema }), guestOfferController.listEntertainments);
router.get("/entertainments/:id", validateSchema({ params: guestOfferIdSchema }), guestOfferController.getEntertainmentById);
router.patch("/entertainments/:id", validateSchema({ params: guestOfferIdSchema, body: guestEntertainmentUpdateSchema }), guestOfferController.updateEntertainment);
router.patch("/entertainments/:id/approval", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: guestOfferIdSchema, body: approvalStatusSchema }), guestOfferController.setEntertainmentApproval);
router.delete("/entertainments/:id", validateSchema({ params: guestOfferIdSchema }), guestOfferController.removeEntertainment);

export { router as GuestOfferRoutes };
