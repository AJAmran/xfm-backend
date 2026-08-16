import { z } from "zod";

const branchIdSchema = z.string().regex(/^\d+$/, "Invalid branch id").optional();

export const reportsQuerySchema = z.object({
  branchId: branchIdSchema,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const reportsBranchQuerySchema = z.object({
  branchId: branchIdSchema,
});

export const reportsExcelQuerySchema = z.object({
  branchId: branchIdSchema,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const reportsInventoryExcelQuerySchema = z.object({
  branchId: branchIdSchema,
  statementMonth: z.string().optional(),
});
