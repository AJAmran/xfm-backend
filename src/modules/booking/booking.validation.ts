import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");

const mobile = z
  .string()
  .trim()
  .min(6, "Mobile number is required")
  .max(20)
  .regex(/^[+\d][\d\s-]{5,19}$/, "Enter a valid phone number (digits, spaces, dashes)");

export const createBookingSchema = z.object({
  branchId: z.number().int().positive(),
  guestName: z.string().trim().min(1, "Guest name is required").max(191),
  guestMobile: mobile,
  partyDate: dateOnly,
  partyType: z.enum(["LUNCH", "DINNER"]),
  initialPax: z.number().int().min(1, "Initial pax must be at least 1").max(100000),
  remarks: z.string().trim().max(2000).optional().nullable(),
  // Managers may book directly as CONFIRMED (skips the tentative step).
  status: z.enum(["TENTATIVE", "CONFIRMED"]).optional().default("TENTATIVE"),
}).strict();

/** Initial pax is intentionally absent — it is immutable after creation. */
export const updateBookingSchema = z.object({
  guestName: z.string().trim().min(1).max(191).optional(),
  guestMobile: mobile.optional(),
  partyDate: dateOnly.optional(),
  partyType: z.enum(["LUNCH", "DINNER"]).optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).strict();

export const bookingQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  sortBy: z.enum(["partyDate", "createdAt", "updatedAt", "guestName", "status", "expectedPax"]).optional().default("partyDate"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
  branchId: z.string().optional(),
  partyDate: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  partyType: z.enum(["LUNCH", "DINNER"]).optional(),
  status: z.enum(["TENTATIVE", "CONFIRMED", "CANCELLED", "COMPLETED"]).optional(),
  search: z.string().optional(),
  missingActual: z.enum(["true", "false"]).optional(),
}).strict();

export const bookingReportQuerySchema = z.object({
  branchId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  partyType: z.enum(["LUNCH", "DINNER"]).optional(),
  status: z.enum(["TENTATIVE", "CONFIRMED", "CANCELLED", "COMPLETED"]).optional(),
}).strict();

export const bookingIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "Invalid booking id"),
}).strict();

export const paxAdjustSchema = z.object({
  type: z.enum(["INCREASE", "DECREASE"]),
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(100000),
  reason: z.string().trim().max(2000).optional().nullable(),
}).strict();

export const actualPaxSchema = z.object({
  actualPax: z.number().int().min(0, "Actual pax cannot be negative").max(100000),
}).strict();

export const bookingStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "CANCELLED", "COMPLETED"]),
  reason: z.string().trim().max(2000).optional().nullable(),
}).strict();

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type BookingQueryInput = z.infer<typeof bookingQuerySchema>;
export type BookingReportQueryInput = z.infer<typeof bookingReportQuerySchema>;
export type PaxAdjustInput = z.infer<typeof paxAdjustSchema>;
export type ActualPaxInput = z.infer<typeof actualPaxSchema>;
export type BookingStatusInput = z.infer<typeof bookingStatusSchema>;
