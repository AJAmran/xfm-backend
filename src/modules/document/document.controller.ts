import { Request, Response } from "express";
import httpStatus from "http-status";
import { createReadStream } from "node:fs";
import * as documentService from "./document.service";
import { getDocumentPolicy, updateDocumentPolicy } from "./document-policy.service";
import { getAuditFeed, getAuditActions } from "./document-audit.service";
import { successResponse } from "../../utils/apiResponse";
import { parsedQuery } from "../../middleware/validation";
import { appError } from "../../utils/appError";
import { canAdministerDocuments } from "./document.logic";
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_APPROVERS,
  type ApprovalQueryInput,
  type ApproverSearchQueryInput,
  type ApproveDocumentInput,
  type AuditQueryInput,
  type CancelDocumentInput,
  type CreateDocumentMetaInput,
  type DocumentPolicyInput,
  type DocumentQueryInput,
  type DocumentTypeInput,
  type RejectDocumentInput,
  type RequestChangesInput,
  type ReviseDocumentMetaInput,
  type SubmitDocumentInput,
  type UpdateDocumentTypeInput,
} from "./document.validation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Request facts recorded alongside every workflow action. */
function requestContext(req: Request) {
  return {
    ipAddress: (req.ip ?? req.socket.remoteAddress ?? null)?.toString().slice(0, 191) ?? null,
    userAgent: req.get("user-agent")?.slice(0, 191) ?? null,
  };
}

/**
 * Reads the uploaded file, re-validating extension AND MIME against the same
 * allow-list the multer filter uses. Defence in depth: a filter bypass must not
 * reach storage.
 */
function requireDocumentUpload(req: Request): Express.Multer.File {
  const file = req.file;
  if (!file) {
    throw appError("Select a document to upload", httpStatus.BAD_REQUEST, [
      { field: "file", message: "A document file is required" },
    ]);
  }

  const name = file.originalname.toLowerCase();
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot) : "";
  const allowedMime = ALLOWED_DOCUMENT_MIME_TYPES[extension];

  if (!(ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension) || !allowedMime) {
    throw appError(
      `Unsupported file type. Allowed formats: ${ALLOWED_DOCUMENT_EXTENSIONS.join(", ")}`,
      httpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
  if (!allowedMime.includes(file.mimetype.toLowerCase())) {
    throw appError(
      `The file content type (${file.mimetype}) does not match its .${extension.replace(".", "")} extension`,
      httpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
  return file;
}

/** Only the signed-in user's own signature may be read or replaced. */
function assertSelf(req: Request): number {
  const target = Number(req.params.userId ?? req.params.id);
  if (target !== req.user!.id) {
    throw appError("You can only manage your own signature", httpStatus.FORBIDDEN);
  }
  return target;
}

function assertAdmin(req: Request): void {
  if (!canAdministerDocuments(req.user!.role)) {
    throw appError("Only a Super Admin can manage document settings", httpStatus.FORBIDDEN);
  }
}

function sendFile(res: Response, fileName: string, mimeType: string, localPath: string, byteLength: number) {
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Length", String(byteLength));
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  createReadStream(localPath).pipe(res);
}

// ─── Documents ────────────────────────────────────────────────────────────────

export async function create(req: Request, res: Response) {
  const file = requireDocumentUpload(req);
  const { approverIds: rawApprovers, ...meta } = req.body as CreateDocumentMetaInput;

  // `approverIds` may arrive as a JSON string (the frontend's choice) or as a
  // repeated form field. A malformed value must never silently degrade into a
  // one-step sequence, so anything unparseable is rejected outright.
  let approvers: number[] = [];
  if (rawApprovers !== undefined) {
    if (Array.isArray(rawApprovers)) {
      approvers = rawApprovers;
    } else {
      try {
        const parsed: unknown = JSON.parse(rawApprovers);
        approvers = Array.isArray(parsed) ? (parsed as number[]) : [parsed as number];
      } catch {
        throw appError("The approver list is malformed", httpStatus.BAD_REQUEST, [
          { field: "approverIds", message: "Send approverIds as a JSON array of user ids" },
        ]);
      }
    }
    approvers = approvers.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (approvers.length > MAX_APPROVERS) {
      throw appError(`At most ${MAX_APPROVERS} approvers are allowed`, httpStatus.BAD_REQUEST);
    }
  }

  const document = await documentService.createDocument(meta, file, approvers, req.user!, requestContext(req));
  successResponse(res, "Document created successfully", document, httpStatus.CREATED);
}

export async function list(req: Request, res: Response) {
  const query = parsedQuery<DocumentQueryInput>(res);
  const result = await documentService.getPaginatedDocuments(query, req.user!);
  successResponse(res, "Documents retrieved successfully", result);
}

export async function summary(req: Request, res: Response) {
  successResponse(res, "Document summary retrieved successfully", await documentService.getDocumentSummary(req.user!));
}

export async function getById(req: Request, res: Response) {
  const document = await documentService.getDocumentById(Number(req.params.id), req.user!, requestContext(req));
  successResponse(res, "Document retrieved successfully", document);
}

export async function submit(req: Request, res: Response) {
  const document = await documentService.submitDocument(
    Number(req.params.id),
    req.body as SubmitDocumentInput,
    req.user!,
    requestContext(req),
  );
  successResponse(res, "Document submitted for approval", document);
}

export async function approve(req: Request, res: Response) {
  const document = await documentService.approveAndSign(
    Number(req.params.id),
    req.body as ApproveDocumentInput,
    req.user!,
    requestContext(req),
  );
  successResponse(res, "Approved and signed. The document has moved to the next approver.", document);
}

export async function reject(req: Request, res: Response) {
  const document = await documentService.rejectDocument(
    Number(req.params.id),
    req.body as RejectDocumentInput,
    req.user!,
    requestContext(req),
  );
  successResponse(res, "Document rejected", document);
}

export async function requestChanges(req: Request, res: Response) {
  const document = await documentService.requestChanges(
    Number(req.params.id),
    req.body as RequestChangesInput,
    req.user!,
    requestContext(req),
  );
  successResponse(res, "Changes requested. The document is back with its creator.", document);
}

export async function revise(req: Request, res: Response) {
  const file = requireDocumentUpload(req);
  const document = await documentService.createRevision(
    Number(req.params.id),
    req.body as ReviseDocumentMetaInput,
    file,
    req.user!,
    requestContext(req),
  );
  successResponse(res, "New version created. Approval will restart from the first approver.", document, httpStatus.CREATED);
}

export async function cancel(req: Request, res: Response) {
  const document = await documentService.cancelDocument(
    Number(req.params.id),
    req.body as CancelDocumentInput,
    req.user!,
    requestContext(req),
  );
  successResponse(res, "Document cancelled", document);
}

export async function archive(req: Request, res: Response) {
  const document = await documentService.archiveDocument(Number(req.params.id), req.user!, requestContext(req));
  successResponse(res, "Document archived", document);
}

export async function remove(req: Request, res: Response) {
  await documentService.deleteDocument(Number(req.params.id), req.user!);
  successResponse(res, "Document deleted successfully", {});
}

export async function versions(req: Request, res: Response) {
  const result = await documentService.getDocumentVersions(Number(req.params.id), req.user!);
  successResponse(res, "Document versions retrieved successfully", result);
}

export async function workflow(req: Request, res: Response) {
  const result = await documentService.getDocumentWorkflow(Number(req.params.id), req.user!);
  successResponse(res, "Document workflow retrieved successfully", result);
}

export async function audit(req: Request, res: Response) {
  const result = await documentService.getDocumentAuditTrail(Number(req.params.id), req.user!);
  successResponse(res, "Document audit trail retrieved successfully", result);
}

export async function download(req: Request, res: Response) {
  const target = await documentService.getFileDownload(Number(req.params.fileId), req.user!);
  if (target.localPath) {
    sendFile(res, target.fileName, target.contentType, target.localPath, target.byteLength);
    return;
  }
  // Cloudinary: a short-lived signed URL keeps the asset itself private.
  res.redirect(httpStatus.FOUND, target.url!);
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export async function pending(req: Request, res: Response) {
  const query = parsedQuery<ApprovalQueryInput>(res);
  successResponse(res, "Pending approvals retrieved successfully", await documentService.getPendingApprovals(query, req.user!));
}

export async function history(req: Request, res: Response) {
  const query = parsedQuery<ApprovalQueryInput>(res);
  successResponse(res, "Approval history retrieved successfully", await documentService.getApprovalHistory(query, req.user!));
}

export async function validateSequence(req: Request, res: Response) {
  const approverIds = Array.isArray(req.body?.approverIds) ? (req.body.approverIds as number[]) : [];
  successResponse(res, "Approval sequence validated", await documentService.validateSequence(approverIds, req.user!.id));
}

export async function approverDirectory(req: Request, res: Response) {
  const query = parsedQuery<ApproverSearchQueryInput>(res);
  const result = await documentService.getApproverDirectory(query.search, Number(query.limit));
  successResponse(res, "Approver directory retrieved successfully", result);
}

// ─── Administration ───────────────────────────────────────────────────────────

export async function listTypes(_req: Request, res: Response) {
  successResponse(res, "Document types retrieved successfully", await documentService.getDocumentTypes());
}

export async function createType(req: Request, res: Response) {
  assertAdmin(req);
  const type = await documentService.createDocumentType(req.body as DocumentTypeInput);
  successResponse(res, "Document type created successfully", type, httpStatus.CREATED);
}

export async function updateType(req: Request, res: Response) {
  assertAdmin(req);
  const type = await documentService.updateDocumentType(Number(req.params.id), req.body as UpdateDocumentTypeInput);
  successResponse(res, "Document type updated successfully", type);
}

export async function deleteType(req: Request, res: Response) {
  assertAdmin(req);
  await documentService.deleteDocumentType(Number(req.params.id));
  successResponse(res, "Document type deleted successfully", {});
}

export async function getPolicy(_req: Request, res: Response) {
  successResponse(res, "Document policy retrieved successfully", await getDocumentPolicy());
}

export async function setPolicy(req: Request, res: Response) {
  assertAdmin(req);
  const policy = await updateDocumentPolicy(req.body as DocumentPolicyInput);
  successResponse(res, "Document policy updated successfully", policy);
}

export async function auditFeed(req: Request, res: Response) {
  assertAdmin(req);
  const query = parsedQuery<AuditQueryInput>(res);
  successResponse(res, "Audit feed retrieved successfully", await getAuditFeed(query));
}

export async function auditActions(req: Request, res: Response) {
  assertAdmin(req);
  successResponse(res, "Audit actions retrieved successfully", await getAuditActions());
}

export async function storageInfo(_req: Request, res: Response) {
  successResponse(res, "Storage information retrieved successfully", await documentService.getStorageInfo());
}

export async function runSla(req: Request, res: Response) {
  assertAdmin(req);
  successResponse(res, "Reminder and escalation sweep completed", await documentService.runSlaSweep());
}

export { assertSelf, requireDocumentUpload };