import { Request, Response } from "express";
import httpStatus from "http-status";
import * as inventoryService from "./inventory.service";
import { successResponse } from "../../utils/apiResponse";
import { parsedQuery } from "../../middleware/validation";
import { InventoryStatementQueryInput, InventoryItemQueryInput, InventoryReportQueryInput } from "./inventory.validation";

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategories(req: Request, res: Response) {
  const categories = await inventoryService.getCategories(req.query.includeInactive === "true");
  successResponse(res, "Inventory categories retrieved successfully", categories);
}

export async function createCategory(req: Request, res: Response) {
  const category = await inventoryService.createCategory(req.body);
  successResponse(res, "Inventory category created successfully", category, httpStatus.CREATED);
}

export async function updateCategory(req: Request, res: Response) {
  const category = await inventoryService.updateCategory(Number(req.params.id), req.body);
  successResponse(res, "Inventory category updated successfully", category);
}

export async function removeCategory(req: Request, res: Response) {
  await inventoryService.deleteCategory(Number(req.params.id));
  successResponse(res, "Inventory category deleted successfully", {});
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function listItems(req: Request, res: Response) {
  const query = parsedQuery<InventoryItemQueryInput>(res);
  const result = await inventoryService.getItems(query);
  successResponse(res, "Inventory items retrieved successfully", result);
}

export async function createItem(req: Request, res: Response) {
  const item = await inventoryService.createItem(req.body);
  successResponse(res, "Inventory item created successfully", item, httpStatus.CREATED);
}

export async function updateItem(req: Request, res: Response) {
  const item = await inventoryService.updateItem(Number(req.params.id), req.body);
  successResponse(res, "Inventory item updated successfully", item);
}

export async function removeItem(req: Request, res: Response) {
  await inventoryService.deleteItem(Number(req.params.id));
  successResponse(res, "Inventory item deleted successfully", {});
}

// ─── Statements ───────────────────────────────────────────────────────────────

export async function createStatement(req: Request, res: Response) {
  const statement = await inventoryService.createStatement(req.body, req.user!);
  successResponse(res, "Inventory statement created successfully", statement, httpStatus.CREATED);
}

export async function listStatements(req: Request, res: Response) {
  const query = parsedQuery<InventoryStatementQueryInput>(res);
  const result = await inventoryService.getPaginatedStatements(query, req.user!);
  successResponse(res, "Inventory statements retrieved successfully", result);
}

export async function getStatement(req: Request, res: Response) {
  const statement = await inventoryService.getStatementById(Number(req.params.id), req.user!);
  successResponse(res, "Inventory statement retrieved successfully", statement);
}

export async function getStatementLines(req: Request, res: Response) {
  const result = await inventoryService.getStatementLines(Number(req.params.id), req.user!);
  successResponse(res, "Inventory statement lines retrieved successfully", result);
}

export async function updateStatementLines(req: Request, res: Response) {
  const result = await inventoryService.updateStatementLines(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Inventory statement lines updated successfully", result);
}

export async function updateStatementStatus(req: Request, res: Response) {
  const statement = await inventoryService.updateStatementStatus(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Inventory statement status updated successfully", statement);
}

// ─── Report ───────────────────────────────────────────────────────────────────

export async function getInventoryReport(req: Request, res: Response) {
  const query = parsedQuery<InventoryReportQueryInput>(res);
  const report = await inventoryService.getInventoryReport(query, req.user!);
  successResponse(res, "Inventory report retrieved successfully", report);
}
