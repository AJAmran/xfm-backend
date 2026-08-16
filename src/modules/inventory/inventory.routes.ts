import { Router } from "express";
import * as inventoryController from "./inventory.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { Role } from "../../../generated/prisma/enums";
import {
  inventoryCategoryCreateSchema,
  inventoryCategoryUpdateSchema,
  inventoryItemCreateSchema,
  inventoryItemUpdateSchema,
  inventoryItemQuerySchema,
  inventoryStatementCreateSchema,
  inventoryStatementQuerySchema,
  inventoryLineUpdateSchema,
  inventoryStatementStatusSchema,
  inventoryIdSchema,
  inventoryReportQuerySchema,
} from "./inventory.validation";

const router = Router();

router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN, Role.BRANCH_MANAGER));

// Categories & items — admin only for writes, all roles can read
router.get("/categories", inventoryController.listCategories);
router.post("/categories", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ body: inventoryCategoryCreateSchema }), inventoryController.createCategory);
router.patch("/categories/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: inventoryIdSchema, body: inventoryCategoryUpdateSchema }), inventoryController.updateCategory);
router.delete("/categories/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: inventoryIdSchema }), inventoryController.removeCategory);

router.get("/items", validateSchema({ query: inventoryItemQuerySchema }), inventoryController.listItems);
router.post("/items", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ body: inventoryItemCreateSchema }), inventoryController.createItem);
router.patch("/items/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: inventoryIdSchema, body: inventoryItemUpdateSchema }), inventoryController.updateItem);
router.delete("/items/:id", authGuard(Role.SUPER_ADMIN, Role.ADMIN), validateSchema({ params: inventoryIdSchema }), inventoryController.removeItem);

// Statements
router.post("/statements", validateSchema({ body: inventoryStatementCreateSchema }), inventoryController.createStatement);
router.get("/statements", validateSchema({ query: inventoryStatementQuerySchema }), inventoryController.listStatements);
router.get("/statements/:id", validateSchema({ params: inventoryIdSchema }), inventoryController.getStatement);
router.get("/statements/:id/lines", validateSchema({ params: inventoryIdSchema }), inventoryController.getStatementLines);
router.patch("/statements/:id/lines", validateSchema({ params: inventoryIdSchema, body: inventoryLineUpdateSchema }), inventoryController.updateStatementLines);
router.patch("/statements/:id/status", validateSchema({ params: inventoryIdSchema, body: inventoryStatementStatusSchema }), inventoryController.updateStatementStatus);

// Report
router.get("/report", validateSchema({ query: inventoryReportQuerySchema }), inventoryController.getInventoryReport);

export { router as InventoryRoutes };
