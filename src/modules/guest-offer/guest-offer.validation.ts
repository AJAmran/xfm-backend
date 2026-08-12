import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");

export const guestDiscountCreateSchema = z.object({
  branchId: z.number().int().positive(),
  logDate: dateOnly,
  guestName: z.string().trim().min(1, "Guest name is required"),
  mobile: z.string().trim().min(1, "Mobile number is required"),
  hadLunch: z.boolean().optional().default(false),
  hadDinner: z.boolean().optional().default(false),
  totalBill: z.number().positive().multipleOf(0.01, "totalBill must have at most 2 decimal places"),
  discountPercent: z.number().positive().max(100).multipleOf(0.01, "discountPercent must have at most 2 decimal places"),
  reasonForDiscount: z.string().trim().min(1, "Reason for discount is required"),
}).strict();

export const guestDiscountUpdateSchema = guestDiscountCreateSchema.partial();

export const guestEntertainmentCreateSchema = z.object({
  branchId: z.number().int().positive(),
  logDate: dateOnly,
  guestName: z.string().trim().min(1, "Guest name is required"),
  mobile: z.string().trim().min(1, "Mobile number is required"),
  hadLunch: z.boolean().optional().default(false),
  hadDinner: z.boolean().optional().default(false),
  foodName: z.string().trim().min(1, "Food name is required"),
  foodCost: z.number().positive().multipleOf(0.01, "foodCost must have at most 2 decimal places"),
  reasonForEntertainment: z.string().trim().min(1, "Reason for entertainment is required"),
}).strict();

export const guestEntertainmentUpdateSchema = guestEntertainmentCreateSchema.partial();

export const approvalStatusSchema = z.object({
  approvalStatus: z.enum(["APPROVED", "REJECTED"]),
}).strict();

export const guestOfferQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  sortBy: z.string().optional().default("logDate"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  branchId: z.string().optional(),
  logDate: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  search: z.string().optional(),
}).strict();

export const guestOfferIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "Invalid log id"),
}).strict();

export type GuestDiscountCreateInput = z.infer<typeof guestDiscountCreateSchema>;
export type GuestDiscountUpdateInput = z.infer<typeof guestDiscountUpdateSchema>;
export type GuestEntertainmentCreateInput = z.infer<typeof guestEntertainmentCreateSchema>;
export type GuestEntertainmentUpdateInput = z.infer<typeof guestEntertainmentUpdateSchema>;
export type ApprovalStatusInput = z.infer<typeof approvalStatusSchema>;
export type GuestOfferQueryInput = z.infer<typeof guestOfferQuerySchema>;
