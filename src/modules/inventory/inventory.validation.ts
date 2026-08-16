import { z } from "zod";

const monthOnly = z.string().regex(/^\d{4}-\d{2}$/, "Expected a month in YYYY-MM format");

export const inventoryCategoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
}).strict();

export const inventoryCategoryUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const inventoryItemCreateSchema = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1, "Item name is required"),
  sortOrder: z.number().int().min(0).optional().default(0),
}).strict();

export const inventoryItemUpdateSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  name: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const inventoryStatementCreateSchema = z.object({
  branchId: z.number().int().positive().optional(),
  statementMonth: monthOnly,
}).strict();

export const inventoryStatementQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  sortBy: z.string().optional().default("statementMonth"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  branchId: z.string().optional(),
  statementMonth: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "LOCKED"]).optional(),
}).strict();

export const inventoryItemQuerySchema = z.object({
  categoryId: z.string().optional(),
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("100"),
  sortBy: z.string().optional().default("sortOrder"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
}).strict();

export const inventoryLineUpdateSchema = z.object({
  lines: z.array(
    z.object({
      itemId: z.number().int().positive(),
      openingStock: z.number().int().min(0).optional(),
      added: z.number().int().min(0).optional(),
      brokenLost: z.number().int().min(0).optional(),
      reject: z.number().int().min(0).optional(),
    }),
  ).max(500, "Too many lines in a single request"),
}).strict();

export const inventoryStatementStatusSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "LOCKED"]),
}).strict();

export const inventoryReportQuerySchema = z.object({
  branchId: z.string().optional(),
  statementMonth: z.string().optional(),
}).strict();

export const inventoryIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "Invalid id"),
}).strict();

export type InventoryCategoryCreateInput = z.infer<typeof inventoryCategoryCreateSchema>;
export type InventoryCategoryUpdateInput = z.infer<typeof inventoryCategoryUpdateSchema>;
export type InventoryItemCreateInput = z.infer<typeof inventoryItemCreateSchema>;
export type InventoryItemUpdateInput = z.infer<typeof inventoryItemUpdateSchema>;
export type InventoryStatementCreateInput = z.infer<typeof inventoryStatementCreateSchema>;
export type InventoryStatementQueryInput = z.infer<typeof inventoryStatementQuerySchema>;
export type InventoryItemQueryInput = z.infer<typeof inventoryItemQuerySchema>;
export type InventoryLineUpdateInput = z.infer<typeof inventoryLineUpdateSchema>;
export type InventoryStatementStatusInput = z.infer<typeof inventoryStatementStatusSchema>;
export type InventoryReportQueryInput = z.infer<typeof inventoryReportQuerySchema>;
