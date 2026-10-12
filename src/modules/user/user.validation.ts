import { z } from "zod";
import { Role } from "../../../generated/prisma/enums";

export const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  branchId: z.number().int().positive().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(8).optional(),
  role: z.nativeEnum(Role).optional(),
  branchId: z.number().int().positive().nullable().optional(),
  // `isActive` stays editable here (the edit dialog carries a status toggle)
  // but the service rank-guards it: self-deactivation is always rejected and
  // deactivating a senior account requires outranking it.
  isActive: z.boolean().optional(),
});

export const userIdParamSchema = z.object({ id: z.string().regex(/^\d+$/, "Invalid id") }).strict();

export const userQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  sortBy: z.enum(["name", "email", "role", "createdAt"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  search: z.string().optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.string().transform((v) => v === "true").optional(),
});

export const userStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
