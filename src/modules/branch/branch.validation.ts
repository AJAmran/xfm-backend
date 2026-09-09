import { z } from "zod";

export const createBranchSchema = z.object({
  name: z.string().trim().min(1, "Branch name is required"),
  code: z.string().trim().min(1, "Branch code is required"),
  address: z.string().trim().min(1, "Address is required"),
  phone: z.string().trim().nullable().optional(),
  latitude: z.number({ error: "Latitude must be a number" }).min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90"),
  longitude: z.number({ error: "Longitude must be a number" }).min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180"),
  capacity: z.number().int().positive().optional().nullable(),
});

export const updateBranchSchema = z.object({
  name: z.string().trim().min(1, "Branch name is required").optional(),
  code: z.string().trim().min(1, "Branch code is required").optional(),
  address: z.string().trim().min(1, "Address is required").optional(),
  phone: z.string().trim().nullable().optional(),
  latitude: z.number({ error: "Latitude must be a number" }).min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90").optional(),
  longitude: z.number({ error: "Longitude must be a number" }).min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180").optional(),
  capacity: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const branchQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  sortBy: z.string().optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  search: z.string().optional(),
  isActive: z.string().transform((v) => v === "true").optional(),
});

export const branchStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type BranchQueryInput = z.infer<typeof branchQuerySchema>;
