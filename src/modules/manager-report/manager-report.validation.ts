import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");

const guestComplaintSchema = z.object({
  guestName: z.string().trim().min(1, "Guest name is required"),
  mobile: z.string().trim().min(1, "Mobile number is required"),
  email: z.string().email().trim().optional().nullable(),
  complaintDetails: z.string().trim().min(1, "Complaint details are required"),
  serviceProviderName: z.string().trim().optional().default(""),
  responsiblePerson: z.string().trim().optional().default(""),
  actionTaken: z.string().trim().min(1, "Action taken is required"),
  solution: z.string().trim().min(1, "Solution is required"),
});

const bpCpEntrySchema = z.object({
  entryType: z.enum(["TODAY", "TOMORROW"]),
  guestName: z.string().trim().min(1, "Guest name is required"),
  mobile: z.string().trim().min(1, "Mobile number is required"),
  comment: z.string().trim().optional().nullable(),
});

export const createManagerReportSchema = z.object({
  branchId: z.number().int().positive(),
  managerName: z.string().trim().min(1, "Manager name is required"),
  reportDate: dateOnly,
  managerComments: z.string().trim().default(""),
  supplyPurchaseIssues: z.string().trim().default(""),
  briefingPoints: z.string().trim().default(""),
  dailyLearnings: z.string().trim().default(""),
  complaints: z.array(guestComplaintSchema).max(50).optional().default([]),
  bpCpEntries: z.array(bpCpEntrySchema).max(50).optional().default([]),
}).strict();

export const updateManagerReportSchema = z.object({
  managerName: z.string().trim().min(1).optional(),
  reportDate: dateOnly.optional(),
  managerComments: z.string().trim().optional(),
  supplyPurchaseIssues: z.string().trim().optional(),
  briefingPoints: z.string().trim().optional(),
  dailyLearnings: z.string().trim().optional(),
  complaints: z.array(guestComplaintSchema).max(50).optional(),
  bpCpEntries: z.array(bpCpEntrySchema).max(50).optional(),
}).strict();

export const managerReportQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  sortBy: z.string().optional().default("reportDate"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  branchId: z.string().optional(),
  managerName: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
}).strict();

export const approvalStatusSchema = z.object({
  approvalStatus: z.enum(["APPROVED", "REJECTED"]),
  approvalComment: z.string().trim().max(1000).optional(),
}).strict();

export const createManagerReportCommentSchema = z.object({
  comment: z.string().trim().min(1, "Comment is required").max(2000),
}).strict();

export const managerReportIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "Invalid report id"),
}).strict();

export type CreateManagerReportInput = z.infer<typeof createManagerReportSchema>;
export type UpdateManagerReportInput = z.infer<typeof updateManagerReportSchema>;
export type ManagerReportQueryInput = z.infer<typeof managerReportQuerySchema>;
export type ApprovalStatusInput = z.infer<typeof approvalStatusSchema>;
export type CreateManagerReportCommentInput = z.infer<typeof createManagerReportCommentSchema>;
