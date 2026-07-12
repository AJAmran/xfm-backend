import { z } from "zod";

export const reportsQuerySchema = z.object({
  branchId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const reportsBranchQuerySchema = z.object({
  branchId: z.string().optional(),
});

export const reportsExcelQuerySchema = z.object({
  branchId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
