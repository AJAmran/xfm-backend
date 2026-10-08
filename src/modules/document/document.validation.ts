import { z } from "zod";

/** Extensions the module accepts. Mirrored by the multer file filter. */
export const ALLOWED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
] as const;

/** MIME types accepted per extension. Rejecting anything else blocks polyglots. */
export const ALLOWED_DOCUMENT_MIME_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel", "application/msexcel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
};

export const ALLOWED_SIGNATURE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
export const MAX_APPROVERS = 25;

const idParam = z.string().regex(/^\d+$/, "Invalid id");

export const documentIdSchema = z.object({ id: idParam }).strict();

export const documentFileIdSchema = z
  .object({ fileId: z.string().regex(/^\d+$/, "Invalid file id") })
  .strict();

/**
 * Metadata for a new document.
 *
 * `.strip()` (not `.strict()`): this schema validates a MULTIPART body, and
 * multipart parsers add fields of their own. `approverIds` is carried here as a
 * loosely-typed value because a multipart field arrives as a JSON string (or a
 * repeated string) — the controller normalises it before use.
 */
export const createDocumentMetaSchema = z
  .object({
    title: z.string().trim().min(3, "Title is required").max(191),
    description: z.string().trim().max(5000).optional().nullable().default(null),
    documentTypeId: z.coerce.number().int().positive("Select a document type"),
    branchId: z.coerce.number().int().positive().optional().nullable(),
    referenceAmount: z.coerce.number().nonnegative().max(99_999_999_999).optional().nullable(),
    changeSummary: z.string().trim().max(1000).optional().nullable().default(null),
    submit: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional()
      .transform((v) => v === true || v === "true"),
    approverIds: z
      .union([z.string(), z.array(z.coerce.number().int().positive())])
      .optional(),
  })
  .strip();

/** Approver sequence submitted alongside the file on creation (optional). */
export const createDocumentApproversSchema = z
  .object({
    approverIds: z.array(z.coerce.number().int().positive()).max(MAX_APPROVERS).optional().default([]),
  })
  .strict();

export const submitDocumentSchema = z
  .object({
    approverIds: z.array(z.coerce.number().int().positive()).min(1, "Select at least one approver").max(MAX_APPROVERS),
  })
  .strict();

export const placementSchema = z
  .object({
    pageNumber: z.coerce.number().int().min(1, "Select a page"),
    // Percentages of the page box (0-100) — never raw pixels.
    x: z.coerce.number().min(0).max(100),
    y: z.coerce.number().min(0).max(100),
    width: z.coerce.number().positive(),
    height: z.coerce.number().positive(),
  })
  .strict();

export const approveDocumentSchema = z
  .object({
    placement: placementSchema,
    comments: z.string().trim().max(2000).optional().nullable().default(null),
    // Client-generated key. Replaying the same key returns the first result
    // instead of creating a second approval.
    idempotencyKey: z.string().trim().min(8).max(64).optional(),
  })
  .strict();

export const rejectDocumentSchema = z
  .object({
    reason: z.string().trim().min(5, "A rejection reason is required").max(2000),
  })
  .strict();

export const requestChangesSchema = z
  .object({
    reason: z.string().trim().min(5, "Tell the creator what needs to change").max(2000),
  })
  .strict();

export const reviseDocumentMetaSchema = z
  .object({
    changeSummary: z.string().trim().min(3, "Describe what changed").max(1000),
    notes: z.string().trim().max(5000).optional().nullable().default(null),
  })
  .strip();

export const cancelDocumentSchema = z
  .object({
    reason: z.string().trim().min(5, "A cancellation reason is required").max(2000),
  })
  .strict();

export const documentQuerySchema = z
  .object({
    page: z.string().optional().default("1"),
    limit: z.string().optional().default("20"),
    sortBy: z.string().optional().default("updatedAt"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    status: z
      .enum([
        "DRAFT",
        "SUBMITTED",
        "PENDING_APPROVAL",
        "IN_REVIEW",
        "RETURNED_FOR_REVISION",
        "REJECTED",
        "APPROVED",
        "CANCELLED",
        "EXPIRED",
        "ARCHIVED",
      ])
      .optional(),
    documentTypeId: z.string().optional(),
    branchId: z.string().optional(),
    createdByUserId: z.string().optional(),
    currentApproverId: z.string().optional(),
    search: z.string().trim().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    /** Convenience buckets used by the module navigation. */
    view: z.enum(["ALL", "MINE", "PENDING_APPROVAL", "RETURNED", "REJECTED", "APPROVED", "ARCHIVED"]).optional(),
  })
  .strict();

export const approvalQuerySchema = z
  .object({
    page: z.string().optional().default("1"),
    limit: z.string().optional().default("20"),
    status: z.enum(["PENDING", "DECIDED", "ALL"]).optional().default("PENDING"),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    page: z.string().optional().default("1"),
    limit: z.string().optional().default("50"),
    documentId: z.string().optional(),
    action: z.string().optional(),
  })
  .strict();

export const approverSearchQuerySchema = z
  .object({
    search: z.string().trim().optional(),
    limit: z.string().optional().default("50"),
  })
  .strict();

export const documentTypeSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    code: z.string().trim().min(2).max(64).regex(/^[A-Z0-9_-]+$/, "Code may contain A-Z, 0-9, hyphen and underscore"),
    description: z.string().trim().max(2000).optional().nullable().default(null),
    defaultSlaHours: z.coerce.number().int().min(1).max(720).optional().default(48),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  })
  .strict();

export const updateDocumentTypeSchema = documentTypeSchema.partial().strict();

/** Accepts a real boolean or its string form (multipart bodies are all strings). */
const boolish = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true");

export const documentPolicySchema = z
  .object({
    hierarchyPolicy: z.enum(["NONE", "JUNIOR_TO_SENIOR"]).optional(),
    minApprovers: z.coerce.number().int().min(1).max(25).optional(),
    maxApprovers: z.coerce.number().int().min(1).max(25).optional(),
    allowCreatorAsApprover: boolish.optional(),
    reminderAfterHours: z.coerce.number().int().min(1).max(720).optional(),
    escalateAfterHours: z.coerce.number().int().min(1).max(720).optional(),
    maxApprovalDays: z.coerce.number().int().min(1).max(90).optional(),
    requireSignature: boolish.optional(),
  })
  .strict();

export type CreateDocumentMetaInput = z.infer<typeof createDocumentMetaSchema>;
export type CreateDocumentApproversInput = z.infer<typeof createDocumentApproversSchema>;
export type SubmitDocumentInput = z.infer<typeof submitDocumentSchema>;
export type PlacementInput = z.infer<typeof placementSchema>;
export type ApproveDocumentInput = z.infer<typeof approveDocumentSchema>;
export type RejectDocumentInput = z.infer<typeof rejectDocumentSchema>;
export type RequestChangesInput = z.infer<typeof requestChangesSchema>;
export type ReviseDocumentMetaInput = z.infer<typeof reviseDocumentMetaSchema>;
export type CancelDocumentInput = z.infer<typeof cancelDocumentSchema>;
export type DocumentQueryInput = z.infer<typeof documentQuerySchema>;
export type ApprovalQueryInput = z.infer<typeof approvalQuerySchema>;
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
export type ApproverSearchQueryInput = z.infer<typeof approverSearchQuerySchema>;
export type DocumentTypeInput = z.infer<typeof documentTypeSchema>;
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeSchema>;
export type DocumentPolicyInput = z.infer<typeof documentPolicySchema>;