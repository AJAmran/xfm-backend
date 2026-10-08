import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { AuditQueryInput } from "./document.validation";

/**
 * Append-only audit trail for the document module.
 *
 * There is deliberately no update or delete function: once written, an entry
 * can only be read. `DocumentAuditLog` rows cascade-delete with their document
 * as the single exception, so a hard-deleted document cannot leave orphaned
 * history pointing at a missing document.
 */

export type AuditAction =
  | "DOCUMENT_CREATED"
  | "FILE_UPLOADED"
  | "SUBMITTED_FOR_APPROVAL"
  | "APPROVAL_STARTED"
  | "APPROVED_AND_SIGNED"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "REVISION_CREATED"
  | "RESUBMITTED"
  | "FINAL_PDF_GENERATED"
  | "DOCUMENT_LOCKED"
  | "DOCUMENT_ARCHIVED"
  | "DOCUMENT_CANCELLED"
  | "SIGNATURE_PLACEMENT_FAILED";

export interface AuditEntryInput {
  documentId: number;
  documentVersion: number;
  workflowStepId?: number | null;
  actorUserId?: number | null;
  action: AuditAction | string;
  previousStatus?: string | null;
  newStatus?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export async function recordAudit(input: AuditEntryInput): Promise<void> {
  await prisma.documentAuditLog.create({
    data: {
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      workflowStepId: input.workflowStepId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      previousStatus: (input.previousStatus ?? null) as never,
      newStatus: (input.newStatus ?? null) as never,
      reason: input.reason ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress ?? null,
    },
  });
}

/**
 * Writes several audit rows inside an existing transaction so the trail and the
 * state change commit together — a recorded action always matches the state it
 * produced.
 */
export async function recordAuditInTransaction(
  tx: Prisma.TransactionClient,
  input: AuditEntryInput,
): Promise<void> {
  await tx.documentAuditLog.create({
    data: {
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      workflowStepId: input.workflowStepId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      previousStatus: (input.previousStatus ?? null) as never,
      newStatus: (input.newStatus ?? null) as never,
      reason: input.reason ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress ?? null,
    },
  });
}

export async function getDocumentAudit(documentId: number, limit = 200) {
  const logs = await prisma.documentAuditLog.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
    include: {
      actor: { select: { id: true, name: true, role: true } },
    },
  });

  return logs.map((log) => ({
    id: log.id,
    documentId: log.documentId,
    documentVersion: log.documentVersion,
    workflowStepId: log.workflowStepId,
    action: log.action,
    actorId: log.actorUserId,
    actorName: log.actor?.name ?? "System",
    actorRole: log.actor?.role ?? null,
    previousStatus: log.previousStatus,
    newStatus: log.newStatus,
    reason: log.reason,
    metadata: (log.metadata as Record<string, unknown> | null) ?? null,
    createdAt: log.createdAt.toISOString(),
  }));
}

/** Platform-wide audit feed for the Document Administration screen. */
export async function getAuditFeed(query: AuditQueryInput) {
  const pagination = transformPagination(query);
  const where: Prisma.DocumentAuditLogWhereInput = {};
  if (query.documentId) where.documentId = Number(query.documentId);
  if (query.action) where.action = query.action;

  const [data, total] = await prisma.$transaction([
    prisma.documentAuditLog.findMany({
      where,
      ...pagination,
      include: {
        actor: { select: { id: true, name: true, role: true } },
        document: { select: { id: true, documentNumber: true, title: true } },
      },
    }),
    prisma.documentAuditLog.count({ where }),
  ]);

  return {
    data: data.map((log) => ({
      id: log.id,
      documentId: log.documentId,
      documentNumber: log.document.documentNumber,
      documentTitle: log.document.title,
      documentVersion: log.documentVersion,
      workflowStepId: log.workflowStepId,
      action: log.action,
      actorId: log.actorUserId,
      actorName: log.actor?.name ?? "System",
      actorRole: log.actor?.role ?? null,
      previousStatus: log.previousStatus,
      newStatus: log.newStatus,
      reason: log.reason,
      metadata: (log.metadata as Record<string, unknown> | null) ?? null,
      createdAt: log.createdAt.toISOString(),
    })),
    meta: buildMetadata(total, pagination),
  };
}

/** Distinct action labels, so the admin filter never invents values. */
export async function getAuditActions(): Promise<string[]> {
  const rows = await prisma.documentAuditLog.groupBy({
    by: ["action"],
    _count: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((r) => r.action);
}