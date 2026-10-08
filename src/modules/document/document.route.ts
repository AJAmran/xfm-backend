import { Router } from "express";
import multer from "multer";
import httpStatus from "http-status";
import * as documentController from "./document.controller";
import * as signatureController from "./signature.controller";
import { authGuard } from "../../middleware/auth";
import { validateSchema } from "../../middleware/validation";
import { Role } from "../../../generated/prisma/enums";
import { appError } from "../../utils/appError";
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  ALLOWED_DOCUMENT_MIME_TYPES,
  ALLOWED_SIGNATURE_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_SIGNATURE_BYTES,
  approveDocumentSchema,
  approvalQuerySchema,
  approverSearchQuerySchema,
  auditQuerySchema,
  cancelDocumentSchema,
  createDocumentMetaSchema,
  documentFileIdSchema,
  documentIdSchema,
  documentPolicySchema,
  documentQuerySchema,
  documentTypeSchema,
  rejectDocumentSchema,
  requestChangesSchema,
  reviseDocumentMetaSchema,
  submitDocumentSchema,
  updateDocumentTypeSchema,
} from "./document.validation";

const router = Router();

/**
 * Multipart handling for document uploads.
 *
 * Memory storage + an explicit allow-list on BOTH extension and MIME type. The
 * controller re-validates before anything reaches storage.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 30 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const dot = name.lastIndexOf(".");
    const extension = dot >= 0 ? name.slice(dot) : "";
    const allowedMime = ALLOWED_DOCUMENT_MIME_TYPES[extension];

    if (!(ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension) || !allowedMime) {
      cb(appError(`Unsupported file type. Allowed: ${ALLOWED_DOCUMENT_EXTENSIONS.join(", ")}`, httpStatus.UNSUPPORTED_MEDIA_TYPE));
      return;
    }
    if (!allowedMime.includes(file.mimetype.toLowerCase())) {
      cb(appError(`File content type (${file.mimetype}) does not match its extension`, httpStatus.UNSUPPORTED_MEDIA_TYPE));
      return;
    }
    cb(null, true);
  },
});

const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIGNATURE_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_SIGNATURE_MIME_TYPES as readonly string[]).includes(file.mimetype.toLowerCase())) {
      cb(appError("A signature must be a PNG, JPEG or WebP image", httpStatus.UNSUPPORTED_MEDIA_TYPE));
      return;
    }
    cb(null, true);
  },
});

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Everyone who may reach the module.
 *
 * Corporate management (DIRECTOR / MANAGER) is included because this module is
 * what they were added for: they create documents and approve them. They hold
 * no user- or branch-administration rights.
 */
const moduleGuard = authGuard(
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.DIRECTOR,
  Role.MANAGER,
  Role.BRANCH_MANAGER,
  Role.COO,
  Role.MD,
);

router.use(moduleGuard);

/** MD (Managing Director) is read-only across the ERP. */
const writeGuard = authGuard(
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.DIRECTOR,
  Role.MANAGER,
  Role.BRANCH_MANAGER,
  Role.COO,
);

/**
 * Approval decisions. Unlike other mutations this includes BRANCH_MANAGER and
 * the corporate tier: any of them may legitimately be an approver when a
 * document is routed to them.
 */
const approveGuard = authGuard(
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.DIRECTOR,
  Role.MANAGER,
  Role.BRANCH_MANAGER,
  Role.COO,
);

/** Administration surface. */
const adminGuard = authGuard(Role.SUPER_ADMIN);

// ─── Directory, types, policy & audit (static segments before /:id) ────────────

router.get("/directory/approvers", validateSchema({ query: approverSearchQuerySchema }), documentController.approverDirectory);
router.get("/types", documentController.listTypes);
router.post("/types", adminGuard, validateSchema({ body: documentTypeSchema }), documentController.createType);
router.patch("/types/:id", adminGuard, validateSchema({ params: documentIdSchema, body: updateDocumentTypeSchema }), documentController.updateType);
router.delete("/types/:id", adminGuard, validateSchema({ params: documentIdSchema }), documentController.deleteType);
router.get("/policy", documentController.getPolicy);
router.patch("/policy", adminGuard, validateSchema({ body: documentPolicySchema }), documentController.setPolicy);
router.get("/audit-feed", adminGuard, validateSchema({ query: auditQuerySchema }), documentController.auditFeed);
router.get("/audit-actions", adminGuard, documentController.auditActions);
router.get("/storage-info", documentController.storageInfo);
router.post("/sla-sweep", adminGuard, documentController.runSla);

router.get("/summary", documentController.summary);

// ─── Self-service signature ───────────────────────────────────────────────────

router.get("/signature", signatureController.get);
router.post("/signature", signatureUpload.single("signature"), signatureController.replace);
router.delete("/signature", signatureController.clear);

// ─── Documents ────────────────────────────────────────────────────────────────

router.post(
  "/",
  writeGuard,
  upload.single("file"),
  validateSchema({ body: createDocumentMetaSchema }),
  documentController.create,
);
router.get("/", validateSchema({ query: documentQuerySchema }), documentController.list);
router.get("/:id", validateSchema({ params: documentIdSchema }), documentController.getById);

router.patch(
  "/:id/submit",
  writeGuard,
  validateSchema({ params: documentIdSchema, body: submitDocumentSchema }),
  documentController.submit,
);
router.post(
  "/:id/approve",
  approveGuard,
  validateSchema({ params: documentIdSchema, body: approveDocumentSchema }),
  documentController.approve,
);
router.post(
  "/:id/reject",
  approveGuard,
  validateSchema({ params: documentIdSchema, body: rejectDocumentSchema }),
  documentController.reject,
);
router.post(
  "/:id/request-changes",
  approveGuard,
  validateSchema({ params: documentIdSchema, body: requestChangesSchema }),
  documentController.requestChanges,
);
router.post(
  "/:id/revisions",
  writeGuard,
  upload.single("file"),
  validateSchema({ params: documentIdSchema, body: reviseDocumentMetaSchema }),
  documentController.revise,
);
router.post(
  "/:id/cancel",
  writeGuard,
  validateSchema({ params: documentIdSchema, body: cancelDocumentSchema }),
  documentController.cancel,
);
router.post("/:id/archive", writeGuard, validateSchema({ params: documentIdSchema }), documentController.archive);
router.delete("/:id", writeGuard, validateSchema({ params: documentIdSchema }), documentController.remove);

router.get("/:id/versions", validateSchema({ params: documentIdSchema }), documentController.versions);
router.get("/:id/workflow", validateSchema({ params: documentIdSchema }), documentController.workflow);
router.get("/:id/audit", validateSchema({ params: documentIdSchema }), documentController.audit);

// Files are streamed only after the service verifies document-level permission.
router.get("/files/:fileId", validateSchema({ params: documentFileIdSchema }), documentController.download);

export { router as DocumentRoutes };