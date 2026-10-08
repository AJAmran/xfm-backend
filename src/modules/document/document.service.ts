import httpStatus from "http-status";
import { Prisma, type DocumentStatus, type WorkflowStepStatus } from "../../../generated/prisma/client";
import { NotificationType } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { publishDataChanged } from "../../lib/realtime";
import { withCache, invalidateByPrefix } from "../../lib/cache";
import { logger } from "../../lib/logger";
import { toEndOfDay, toDateOnly } from "../../utils/dateHelpers";
import {
  storeBuffer,
  resolveDownload,
  readStoredAsset,
  deleteStoredAsset,
  activeProvider,
  sha256,
  type StoredAsset,
  type StorageProviderValue,
} from "../../lib/storage.service";
import { generateFinalSignedPdf, countPdfPages } from "../../lib/document-pdf.service";
import { recordAudit, recordAuditInTransaction, getDocumentAudit } from "./document-audit.service";
import { notifyUser, notifyUsers } from "./document-notification.service";
import { getDocumentPolicy } from "./document-policy.service";
import {
  assertStepDecidable,
  buildApprovalProgress,
  canSubmitDocument,
  computeStepDueAt,
  decideWorkflowOutcome,
  formatDocumentNumber,
  hasDocumentOversight,
  hierarchyRank,
  isTerminalDocument,
  isValidStatusTransition,
  validateApprovalSequence,
  validateSignaturePlacement,
  type ApproverCandidate,
} from "./document.logic";
import type {
  ApproveDocumentInput,
  ApprovalQueryInput,
  CancelDocumentInput,
  CreateDocumentMetaInput,
  DocumentQueryInput,
  PlacementInput,
  RejectDocumentInput,
  RequestChangesInput,
  ReviseDocumentMetaInput,
  SubmitDocumentInput,
} from "./document.validation";

interface AuthUser {
  id: number;
  name: string;
  role: string;
  branchId: number | null;
}

interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const DOCUMENTS_PREFIX = "documents_";
const DOCUMENTS_TTL = 15;

/**
 * Hard ceiling on rows returned by per-document collection reads. Versions and
 * workflow instances grow without bound over a document's life, so they must
 * always be `take`-limited (see AGENTS.md: no unbounded historical reads).
 */
const MAX_VERSIONS_PER_DOCUMENT = 100;

/** Upper bound for the document-type master list. */
const MAX_DOCUMENT_TYPES = 200;

const USER_SELECT = { id: true, name: true, email: true, role: true, branchId: true } as const;

const FILE_SELECT = {
  id: true,
  kind: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  storageProvider: true,
  storageId: true,
  resourceType: true,
  format: true,
  checksum: true,
  pageCount: true,
  createdAt: true,
} as const;

const DOCUMENT_INCLUDE = {
  documentType: { select: { id: true, name: true, code: true, defaultSlaHours: true } },
  branch: { select: { id: true, name: true, code: true } },
  createdBy: { select: USER_SELECT },
  versions: {
    orderBy: { versionNumber: "desc" as const },
    include: { files: { select: FILE_SELECT } },
  },
  files: { select: FILE_SELECT },
} satisfies Prisma.DocumentInclude;

const WORKFLOW_INCLUDE = {
  steps: {
    orderBy: { stepOrder: "asc" as const },
    include: {
      approver: { select: USER_SELECT },
      approval: { include: { signature: true } },
    },
  },
} satisfies Prisma.WorkflowInstanceInclude;

async function invalidateDocumentCaches(): Promise<void> {
  await invalidateByPrefix(DOCUMENTS_PREFIX);
}

function documentsScopeKey(user: AuthUser): string {
  return `u${user.id}_${user.role}`;
}

// ─── Serialisation ────────────────────────────────────────────────────────────

function serialiseFile(file: {
  id: number;
  kind: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storageProvider: string;
  pageCount: number | null;
  createdAt: Date;
}) {
  return {
    id: file.id,
    kind: file.kind,
    originalFileName: file.originalFileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    storageProvider: file.storageProvider,
    pageCount: file.pageCount,
    isViewable: file.kind === "FINAL_SIGNED" || file.mimeType.startsWith("image/") || file.mimeType === "application/pdf",
    createdAt: file.createdAt.toISOString(),
  };
}

function serialiseWorkflow(instance: {
  id: number;
  documentVersion: number;
  status: string;
  currentStepOrder: number | null;
  totalSteps: number;
  startedAt: Date;
  completedAt: Date | null;
  terminatedReason: string | null;
  steps: Array<{
    id: number;
    stepOrder: number;
    approverUserId: number;
    approverNameSnapshot: string;
    approverRoleSnapshot: string;
    status: string;
    assignedAt: Date | null;
    dueAt: Date | null;
    completedAt: Date | null;
    reason: string | null;
    approver: { id: number; name: string; role: string; email: string };
    approval: {
      id: number;
      action: string;
      comments: string | null;
      createdAt: Date;
      signature: {
        pageNumber: number;
        x: number;
        y: number;
        width: number;
        height: number;
        signatureUrl: string;
        signatureSha256: string;
        signedAt: Date;
      } | null;
    } | null;
  }>;
}) {
  const progress = buildApprovalProgress(
    instance.steps.map((s) => ({ status: s.status as never })),
  );
  const activeStep = instance.steps.find((s) => s.status === "ACTIVE") ?? null;

  return {
    id: instance.id,
    documentVersion: instance.documentVersion,
    status: instance.status,
    currentStepOrder: instance.currentStepOrder,
    totalSteps: instance.totalSteps,
    startedAt: instance.startedAt.toISOString(),
    completedAt: instance.completedAt?.toISOString() ?? null,
    terminatedReason: instance.terminatedReason,
    progress,
    currentlyWith: activeStep
      ? {
          userId: activeStep.approverUserId,
          name: activeStep.approver.name || activeStep.approverNameSnapshot,
          role: activeStep.approver.role || activeStep.approverRoleSnapshot,
          stepOrder: activeStep.stepOrder,
          dueAt: activeStep.dueAt?.toISOString() ?? null,
        }
      : null,
    steps: instance.steps.map((step) => ({
      id: step.id,
      stepOrder: step.stepOrder,
      approverUserId: step.approverUserId,
      approverName: step.approver.name || step.approverNameSnapshot,
      approverRole: step.approver.role || step.approverRoleSnapshot,
      approverEmail: step.approver.email,
      status: step.status,
      assignedAt: step.assignedAt?.toISOString() ?? null,
      dueAt: step.dueAt?.toISOString() ?? null,
      completedAt: step.completedAt?.toISOString() ?? null,
      reason: step.reason,
      decision: step.approval
        ? {
            action: step.approval.action,
            comments: step.approval.comments,
            decidedAt: step.approval.createdAt.toISOString(),
            signature: step.approval.signature
              ? {
                  pageNumber: step.approval.signature.pageNumber,
                  x: step.approval.signature.x,
                  y: step.approval.signature.y,
                  width: step.approval.signature.width,
                  height: step.approval.signature.height,
                  url: step.approval.signature.signatureUrl,
                  sha256: step.approval.signature.signatureSha256,
                  signedAt: step.approval.signature.signedAt.toISOString(),
                }
              : null,
          }
        : null,
    })),
  };
}

function serialiseDocument(
  document: Prisma.DocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>,
  workflow: ReturnType<typeof serialiseWorkflow> | null,
  viewer: AuthUser,
) {
  const versions = document.versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    changeSummary: version.changeSummary,
    notes: version.notes,
    pageCount: version.pageCount,
    createdAt: version.createdAt.toISOString(),
    isOriginal: version.versionNumber === 1,
    isCurrent: version.versionNumber === document.currentVersion,
    isFinal: Boolean(workflow && workflow.status === "APPROVED" && version.versionNumber === document.currentVersion),
    files: version.files.map(serialiseFile),
  }));

  const isCreator = document.createdByUserId === viewer.id;

  return {
    id: document.id,
    documentNumber: document.documentNumber,
    title: document.title,
    description: document.description,
    status: document.status,
    currentVersion: document.currentVersion,
    referenceAmount: document.referenceAmount ? Number(document.referenceAmount) : null,
    isLocked: document.isLocked,
    submittedAt: document.submittedAt?.toISOString() ?? null,
    approvedAt: document.approvedAt?.toISOString() ?? null,
    archivedAt: document.archivedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    documentType: document.documentType,
    branch: document.branch,
    createdBy: document.createdBy,
    versions,
    finalFile:
      document.files
        .filter((f) => f.kind === "FINAL_SIGNED")
        .map(serialiseFile)
        .at(-1) ?? null,
    workflow,
    storageProvider: activeProvider(),
    /** Capabilities for the current viewer — the UI never guesses permissions. */
    capabilities: {
      isCreator,
      canSubmit: isCreator && canSubmitDocument(document.status) && !document.isLocked,
      canRevise:
        isCreator &&
        ["RETURNED_FOR_REVISION", "REJECTED", "APPROVED"].includes(document.status),
      canCancel:
        (isCreator || viewer.role === "SUPER_ADMIN" || viewer.role === "ADMIN") &&
        !isTerminalDocument(document.status),
      canArchive: (isCreator || viewer.role === "SUPER_ADMIN") && document.status === "APPROVED",
      canDelete: (isCreator || viewer.role === "SUPER_ADMIN") && document.status !== "IN_REVIEW",
      /** True when the viewer holds the active step right now. */
      canAct: workflow?.currentlyWith?.userId === viewer.id,
    },
  };
}

/**
 * The workflow for the CURRENT version.
 *
 * Scoped deliberately: after a revision the new version has no workflow yet,
 * and `workflow: null` is what tells the UI "not submitted" — whereas the
 * previous cycle still exists in history and must stay readable.
 */
async function loadWorkflow(documentId: number, versionNumber?: number) {
  const instance = await prisma.workflowInstance.findFirst({
    where: {
      documentId,
      ...(versionNumber === undefined ? {} : { documentVersion: versionNumber }),
    },
    orderBy: { documentVersion: "desc" },
    include: WORKFLOW_INCLUDE,
  });
  return instance ? serialiseWorkflow(instance) : null;
}

// ─── Access control ───────────────────────────────────────────────────────────

/**
 * Document-level authorisation.
 *
 * Being authenticated never grants blanket access. A caller may read a document
 * when they created it, when they are an approver on any version of it, or when
 * they hold a corporate oversight role.
 */
function assertCanView(document: { id: number; createdByUserId: number }, user: AuthUser, approverIds: number[]) {
  if (document.createdByUserId === user.id) return;
  if (approverIds.includes(user.id)) return;
  if (hasDocumentOversight(user.role)) return;
  throw appError(
    "You do not have permission to view this document",
    httpStatus.FORBIDDEN,
  );
}

async function approverIdsForDocument(documentId: number): Promise<number[]> {
  const steps = await prisma.workflowStep.findMany({
    where: { workflowInstance: { documentId } },
    select: { approverUserId: true },
    // Bounded by maxApprovers per cycle, but capped explicitly anyway.
    take: MAX_VERSIONS_PER_DOCUMENT * 25,
  });
  return steps.map((s) => s.approverUserId);
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Best-effort page count for an uploaded file.
 *
 * Only PDFs can be counted without a converter. Returning `null` for other
 * formats is honest: it disables the signature page-range check rather than
 * asserting a page count we do not know.
 */
async function detectPageCount(file: Express.Multer.File): Promise<number | null> {
  if (file.mimetype !== "application/pdf") return null;
  return countPdfPages(file.buffer);
}

async function persistSourceFile(
  documentId: number,
  versionId: number,
  versionNumber: number,
  upload: Express.Multer.File,
): Promise<StoredAsset> {
  const scope = `documents/${documentId}/v${versionNumber}`;
  return storeBuffer(upload.buffer, scope, upload.originalname, upload.mimetype);
}

/**
 * Creates a draft document with version 1 and its source file.
 *
 * The uploaded file is stored first (storage is not transactional), then the
 * record is written in a single transaction. If the write fails the orphaned
 * asset is removed so no untracked bytes are left behind.
 */
export async function createDocument(
  meta: CreateDocumentMetaInput,
  upload: Express.Multer.File,
  approvers: number[],
  user: AuthUser,
  ctx: RequestContext = {},
) {
  const documentType = await prisma.documentType.findFirst({
    where: { id: meta.documentTypeId, isDeleted: false, isActive: true },
    select: { id: true, name: true, defaultSlaHours: true },
  });
  if (!documentType) throw appError("The selected document type is unavailable", httpStatus.BAD_REQUEST);

  // Branch managers are locked to their own branch.
  const branchId = user.role === "BRANCH_MANAGER" ? user.branchId : meta.branchId ?? null;

  // Count pages BEFORE any write, so the stored version carries a real page
  // count and the signature page-range check is actually enforced.
  const pageCount = await detectPageCount(upload);

  const created = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        // Placeholder: the final number is derived from the row id so concurrent
        // creates can never collide on the unique index.
        documentNumber: `PENDING-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        title: meta.title,
        description: meta.description ?? null,
        documentTypeId: documentType.id,
        branchId,
        createdByUserId: user.id,
        referenceAmount: meta.referenceAmount ?? null,
        status: "DRAFT",
        currentVersion: 1,
      },
    });

    const numbered = await tx.document.update({
      where: { id: document.id },
      data: { documentNumber: formatDocumentNumber(new Date().getFullYear(), document.id) },
    });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 1,
        changeSummary: meta.changeSummary ?? "Initial document",
        pageCount,
        createdByUserId: user.id,
      },
    });

    await recordAuditInTransaction(tx, {
      documentId: document.id,
      documentVersion: 1,
      actorUserId: user.id,
      action: "DOCUMENT_CREATED",
      newStatus: "DRAFT",
      metadata: { title: meta.title, documentType: documentType.name },
      ipAddress: ctx.ipAddress,
    });

    return { document: numbered, version };
  });

  let asset: StoredAsset;
  try {
    asset = await persistSourceFile(
      created.document.id,
      created.version.id,
      1,
      upload,
    );
  } catch (error) {
    await prisma.document.delete({ where: { id: created.document.id } }).catch(() => undefined);
    throw error;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.documentFile.create({
        data: {
          documentId: created.document.id,
          versionId: created.version.id,
          kind: "SOURCE",
          originalFileName: upload.originalname.slice(0, 191),
          mimeType: upload.mimetype,
          fileSize: asset.bytes,
          storageProvider: asset.provider,
          storageId: asset.storageId,
          resourceType: asset.resourceType,
          format: asset.format,
          checksum: asset.checksum,
          pageCount,
        },
      });

      // Written inside the transaction so the trail can never disagree with
      // the state it describes.
      await recordAuditInTransaction(tx, {
        documentId: created.document.id,
        documentVersion: 1,
        actorUserId: user.id,
        action: "FILE_UPLOADED",
        metadata: { fileName: upload.originalname, bytes: asset.bytes, checksum: asset.checksum },
        ipAddress: ctx.ipAddress,
      });
    });
  } catch (error) {
    // The bytes are already in storage and nothing references them — remove the
    // asset so a failed create leaves no untracked file behind.
    await deleteStoredAsset({
      provider: asset.provider,
      storageId: asset.storageId,
      resourceType: asset.resourceType,
    });
    await prisma.document.delete({ where: { id: created.document.id } }).catch(() => undefined);
    throw error;
  }

  // Optionally submit in the same request so the wizard's final step is one call.
  const result = meta.submit && approvers.length
    ? await submitDocument(created.document.id, { approverIds: approvers }, user, ctx)
    : await getDocumentById(created.document.id, user, ctx);

  await invalidateDocumentCaches();
  publishDataChanged("document.created", { type: "global" });

  return result;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getDocumentById(id: number, user: AuthUser, ctx: RequestContext = {}) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
    include: DOCUMENT_INCLUDE,
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);

  assertCanView(document, user, await approverIdsForDocument(id));
  const workflow = await loadWorkflow(id, document.currentVersion);

  void ctx;
  return {
    ...serialiseDocument(document, workflow, user),
    auditTrail: await getDocumentAudit(id),
  };
}

export async function getPaginatedDocuments(query: DocumentQueryInput, user: AuthUser) {
  const key = `${DOCUMENTS_PREFIX}list_${documentsScopeKey(user)}:${JSON.stringify(query)}`;

  return withCache(key, async () => {
    const pagination = transformPagination({
      page: query.page,
      limit: query.limit,
      // Only allow sortable columns that exist on Document.
      sortBy: ["updatedAt", "createdAt", "documentNumber", "title", "status"].includes(query.sortBy ?? "")
        ? query.sortBy
        : "updatedAt",
      sortOrder: query.sortOrder,
    });

    const where: Prisma.DocumentWhereInput = { isDeleted: false };

    // ── Visibility ──
    // The list MUST mirror `assertCanView`, otherwise a document appears in the
    // grid and 403s on open.
    if (user.role === "BRANCH_MANAGER") {
      // Branch managers see their own documents, their branch's, and anything
      // routed to them.
      where.AND = [
        {
          OR: [
            { createdByUserId: user.id },
            { branchId: user.branchId ?? -1 },
            { workflowInstances: { some: { steps: { some: { approverUserId: user.id } } } } },
          ],
        },
      ];
    } else if (!hasDocumentOversight(user.role)) {
      // Corporate participants (DIRECTOR/MANAGER) are creators and approvers,
      // not auditors: they see what they raised or were routed, and nothing else.
      where.AND = [
        {
          OR: [
            { createdByUserId: user.id },
            { workflowInstances: { some: { steps: { some: { approverUserId: user.id } } } } },
          ],
        },
      ];
    }

    // ── Bucket views used by the module navigation ──
    switch (query.view) {
      case "MINE":
        where.createdByUserId = user.id;
        break;
      case "PENDING_APPROVAL":
        where.status = { in: ["PENDING_APPROVAL", "IN_REVIEW"] };
        break;
      case "RETURNED":
        where.status = "RETURNED_FOR_REVISION";
        break;
      case "REJECTED":
        where.status = "REJECTED";
        break;
      case "APPROVED":
        where.status = "APPROVED";
        break;
      case "ARCHIVED":
        where.status = "ARCHIVED";
        break;
      default:
        if (query.status) where.status = query.status;
    }

    if (query.documentTypeId) where.documentTypeId = Number(query.documentTypeId);
    if (query.branchId) where.branchId = Number(query.branchId);
    if (query.createdByUserId) where.createdByUserId = Number(query.createdByUserId);
    if (query.currentApproverId) {
      where.workflowInstances = {
        some: {
          status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] },
          steps: { some: { approverUserId: Number(query.currentApproverId), status: "ACTIVE" } },
        },
      };
    }
    if (query.search) {
      const term = query.search;
      where.OR = [
        { title: { contains: term } },
        { documentNumber: { contains: term } },
        { description: { contains: term } },
        { createdBy: { name: { contains: term } } },
      ];
    }
    if (query.startDate || query.endDate) {
      const range: Prisma.DateTimeFilter<"Document"> = {};
      if (query.startDate) range.gte = toDateOnly(query.startDate);
      if (query.endDate) range.lte = toEndOfDay(query.endDate);
      where.createdAt = range;
    }

    const [data, total] = await prisma.$transaction([
      prisma.document.findMany({
        where,
        ...pagination,
        include: {
          documentType: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          createdBy: { select: USER_SELECT },
          _count: { select: { versions: true } },
          workflowInstances: {
            where: { status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] } },
            orderBy: { documentVersion: "desc" },
            take: 1,
            select: {
              currentStepOrder: true,
              totalSteps: true,
              // Bounded by `maxApprovers` (25), so selecting every step is cheap
              // and lets us derive both progress and the current holder in JS.
              steps: { select: { status: true, approver: { select: USER_SELECT } } },
            },
          },
        },
      }),
      prisma.document.count({ where }),
    ]);

    return {
      data: data.map((doc) => {
        const active = doc.workflowInstances[0];
        // "Currently With" is the single most important field in this list.
        const holderStep = active?.steps.find((s) => s.status === "ACTIVE");
        return {
          id: doc.id,
          documentNumber: doc.documentNumber,
          title: doc.title,
          status: doc.status,
          currentVersion: doc.currentVersion,
          versionCount: doc._count.versions,
          documentType: doc.documentType,
          branch: doc.branch,
          createdBy: doc.createdBy,
          isLocked: doc.isLocked,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
          currentlyWith: holderStep
            ? {
                userId: holderStep.approver.id,
                name: holderStep.approver.name,
                role: holderStep.approver.role,
              }
            : null,
          approvalProgress: active
            ? {
                approved: active.steps.filter((s) => s.status === "APPROVED").length,
                total: active.totalSteps,
                label: buildApprovalProgress(
                  active.steps.map((s) => ({ status: s.status as never })),
                ).label,
              }
            : null,
        };
      }),
      meta: buildMetadata(total, pagination),
    };
  }, DOCUMENTS_TTL);
}

/** Dashboard counters. One grouped query instead of five counts. */
export async function getDocumentSummary(user: AuthUser) {
  const key = `${DOCUMENTS_PREFIX}summary_${documentsScopeKey(user)}`;

  return withCache(key, async () => {
    const visibility: Prisma.DocumentWhereInput =
      user.role === "BRANCH_MANAGER"
        ? {
            isDeleted: false,
            OR: [
              { createdByUserId: user.id },
              { workflowInstances: { some: { steps: { some: { approverUserId: user.id } } } } },
            ],
          }
        : { isDeleted: false };

    const [byStatus, pendingForMe] = await Promise.all([
      prisma.document.groupBy({
        by: ["status"],
        where: visibility,
        _count: { _all: true },
      }),
      prisma.workflowStep.count({
        where: { approverUserId: user.id, status: "ACTIVE" },
      }),
    ]);

    const counts = byStatus.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {});

    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      mine: await prisma.document.count({ where: { ...visibility, createdByUserId: user.id } }),
      pendingApproval: pendingForMe,
      inFlight: (counts.PENDING_APPROVAL ?? 0) + (counts.IN_REVIEW ?? 0),
      draft: counts.DRAFT ?? 0,
      returned: counts.RETURNED_FOR_REVISION ?? 0,
      rejected: counts.REJECTED ?? 0,
      approved: counts.APPROVED ?? 0,
      archived: counts.ARCHIVED ?? 0,
    };
  }, DOCUMENTS_TTL);
}

// ─── Submit & routing ─────────────────────────────────────────────────────────

async function resolveCandidates(ids: number[]): Promise<ApproverCandidate[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isDeleted: false, isActive: true },
    select: USER_SELECT,
  });
  return users.map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

/**
 * Validates a proposed approval sequence against company policy.
 * Exposed so the wizard can surface violations before the user submits.
 */
export async function validateSequence(approverIds: number[], creatorId: number) {
  const policy = await getDocumentPolicy();
  const candidates = await resolveCandidates(approverIds);
  return { ...validateApprovalSequence(approverIds, candidates, policy, creatorId), policy };
}

async function createWorkflowForVersion(
  tx: Prisma.TransactionClient,
  documentId: number,
  versionId: number,
  versionNumber: number,
  approverIds: number[],
  candidates: ApproverCandidate[],
  slaHours: number,
) {
  const dueAt = computeStepDueAt(slaHours);
  const now = new Date();

  const instance = await tx.workflowInstance.create({
    data: {
      documentId,
      versionId,
      documentVersion: versionNumber,
      status: "PENDING_APPROVAL",
      totalSteps: approverIds.length,
      currentStepOrder: 1,
      steps: {
        create: approverIds.map((id, index) => {
          const candidate = candidates.find((c) => c.id === id)!;
          return {
            stepOrder: index + 1,
            approverUserId: id,
            approverNameSnapshot: candidate.name,
            approverRoleSnapshot: candidate.role,
            status: index === 0 ? ("ACTIVE" as WorkflowStepStatus) : ("PENDING" as WorkflowStepStatus),
            assignedAt: index === 0 ? now : null,
            dueAt: index === 0 ? dueAt : null,
          };
        }),
      },
    },
  });

  return instance;
}

export async function submitDocument(
  id: number,
  payload: SubmitDocumentInput,
  user: AuthUser,
  ctx: RequestContext = {},
) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
    include: { documentType: { select: { defaultSlaHours: true } } },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  if (document.createdByUserId !== user.id) {
    throw appError("Only the creator can submit this document", httpStatus.FORBIDDEN);
  }
  if (document.isLocked) {
    throw appError("This document is locked. Create a new version before submitting.", httpStatus.CONFLICT);
  }
  if (!canSubmitDocument(document.status)) {
    throw appError(
      `A document with status ${document.status} cannot be submitted`,
      httpStatus.CONFLICT,
    );
  }
  if (!isValidStatusTransition(document.status, "PENDING_APPROVAL")) {
    throw appError(`Illegal transition from ${document.status} to PENDING_APPROVAL`, httpStatus.CONFLICT);
  }

  const { valid, errors } = await validateSequence(payload.approverIds, user.id);
  if (!valid) {
    throw appError("The approval sequence does not meet company policy", httpStatus.UNPROCESSABLE_ENTITY, errors);
  }

  const candidates = await resolveCandidates(payload.approverIds);
  const version = await prisma.documentVersion.findUnique({
    where: { documentId_versionNumber: { documentId: id, versionNumber: document.currentVersion } },
  });
  if (!version) throw appError("The current document version is missing", httpStatus.INTERNAL_SERVER_ERROR);

  // A version is approved exactly once. Restarting approval means creating a new
  // version, so historical cycles are never deleted or reused.
  const existingCycle = await prisma.workflowInstance.findUnique({
    where: { versionId: version.id },
    select: { id: true, status: true },
  });
  if (existingCycle) {
    throw appError(
      "This version has already entered approval. Create a new version to restart the approval sequence.",
      httpStatus.CONFLICT,
    );
  }

  const previousStatus = document.status;
  // A version after the first is always a resubmission, even though it starts
  // from DRAFT — the revision workflow makes every new version re-enter approval.
  const resubmission = document.currentVersion > 1 || previousStatus === "RETURNED_FOR_REVISION";

  await prisma.$transaction(async (tx) => {
    await createWorkflowForVersion(
      tx,
      id,
      version.id,
      document.currentVersion,
      payload.approverIds,
      candidates,
      document.documentType.defaultSlaHours,
    );
    await tx.document.update({
      where: { id },
      data: { status: "PENDING_APPROVAL", submittedAt: new Date() },
    });
    await recordAuditInTransaction(tx, {
      documentId: id,
      documentVersion: document.currentVersion,
      actorUserId: user.id,
      action: resubmission ? "RESUBMITTED" : "SUBMITTED_FOR_APPROVAL",
      previousStatus,
      newStatus: "PENDING_APPROVAL",
      metadata: { approvers: candidates.map((c) => `${c.name} (${c.role})`) },
      ipAddress: ctx.ipAddress,
    });
  });

  const first = candidates[0]!;
  await notifyUser({
    type: NotificationType.DOCUMENT_SUBMITTED,
    title: "Action required: review and sign",
    message: `${user.name} submitted "${document.title}" (${document.documentNumber}). You are approver 1 of ${candidates.length}.`,
    userId: first.id,
    documentId: id,
    branchId: document.branchId,
    actorUserId: user.id,
  });

  await invalidateDocumentCaches();
  publishDataChanged("document.submitted", { type: "global" });

  return getDocumentById(id, user, ctx);
}

// ─── Approvals ────────────────────────────────────────────────────────────────

interface ActiveStepContext {
  document: Prisma.DocumentGetPayload<{ include: { documentType: { select: { defaultSlaHours: true } } } }>;
  instance: Prisma.WorkflowInstanceGetPayload<{ include: typeof WORKFLOW_INCLUDE }>;
  step: NonNullable<Prisma.WorkflowInstanceGetPayload<{ include: typeof WORKFLOW_INCLUDE }>["steps"][number]>;
}

async function loadActiveStep(documentId: number, user: AuthUser): Promise<ActiveStepContext> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, isDeleted: false },
    include: { documentType: { select: { defaultSlaHours: true } } },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  if (document.isLocked) throw appError("This document is locked", httpStatus.CONFLICT);
  if (isTerminalDocument(document.status)) {
    throw appError(
      `This document is already ${document.status.toLowerCase()} and cannot be actioned`,
      httpStatus.CONFLICT,
    );
  }

  const instance = await prisma.workflowInstance.findFirst({
    where: { documentId, status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] } },
    orderBy: { documentVersion: "desc" },
    include: WORKFLOW_INCLUDE,
  });
  if (!instance) {
    throw appError("There is no active approval workflow for this document", httpStatus.CONFLICT);
  }

  const step = instance.steps.find((s) => s.status === "ACTIVE");
  if (!step) {
    // The step left ACTIVE between reads — a concurrent request already decided it.
    throw appError(
      "This approval step is no longer active. It may already be completed by another action.",
      httpStatus.CONFLICT,
    );
  }

  const guard = assertStepDecidable(step.status as never, step.approverUserId, user.id);
  if (!guard.ok) {
    throw appError(guard.reason, httpStatus.FORBIDDEN);
  }

  return { document, instance, step };
}

/** Approve & sign: the transaction-safe heart of the module. */
export async function approveAndSign(
  id: number,
  payload: ApproveDocumentInput,
  user: AuthUser,
  ctx: RequestContext = {},
) {
  const { document, instance, step } = await loadActiveStep(id, user);

  const version = await prisma.documentVersion.findUnique({
    where: {
      documentId_versionNumber: { documentId: id, versionNumber: instance.documentVersion },
    },
    select: { id: true, versionNumber: true, pageCount: true },
  });
  if (!version) throw appError("The document version is missing", httpStatus.INTERNAL_SERVER_ERROR);

  const placement = payload.placement as PlacementInput;
  const placementCheck = validateSignaturePlacement(placement, version.pageCount);
  if (!placementCheck.valid) {
    throw appError("The signature placement is invalid", httpStatus.UNPROCESSABLE_ENTITY, placementCheck.errors);
  }

  const policy = await getDocumentPolicy();
  const signer = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      role: true,
      signatureAssetId: true,
      signatureProvider: true,
      signatureUrl: true,
    },
  });
  if (!signer) throw appError("Your user profile could not be loaded", httpStatus.INTERNAL_SERVER_ERROR);

  // A user may only ever sign with their own saved signature. The asset is
  // resolved from the DATABASE — never from the request body — and is read
  // through the provider that actually holds it.
  let signatureBytes: Buffer = Buffer.alloc(0);
  let signatureUrl = "";
  let signatureStorageId: string;
  if (signer.signatureAssetId && signer.signatureUrl) {
    signatureBytes = await readStoredAsset({
      provider: (signer.signatureProvider ?? "LOCAL_SECURE") as StorageProviderValue,
      storageId: signer.signatureAssetId,
      resourceType: "image",
    });
    signatureUrl = signer.signatureUrl;
    signatureStorageId = signer.signatureAssetId;
  } else if (policy.requireSignature) {
    throw appError(
      "You have no saved signature. Add one in your profile before approving.",
      httpStatus.UNPROCESSABLE_ENTITY,
      [{ field: "signature", message: "Upload a signature image in your profile first" }],
    );
  } else {
    signatureStorageId = `text-only-${user.id}`;
  }

  const now = new Date();
  const signatureSha256 = sha256(
    signatureBytes.length
      ? signatureBytes
      : Buffer.from(`${signer.name}:${user.id}:${now.toISOString()}`),
  );
  const outcome = decideWorkflowOutcome("APPROVE_AND_SIGN", {
    stepOrder: step.stepOrder,
    totalSteps: instance.totalSteps,
    status: step.status as never,
    decidedBy: step.approverUserId,
  });

  const nextDocumentStatus =
    outcome.kind === "FINALISE" ? "APPROVED" : "IN_REVIEW";

  await prisma.$transaction(
    async (tx) => {
      // Compare-and-swap: only an ACTIVE step can be decided, so a double-click,
      // a second tab or two concurrent requests can never both win.
      const claimed = await tx.workflowStep.updateMany({
        where: { id: step.id, status: "ACTIVE", approverUserId: user.id },
        data: {
          status: "APPROVED",
          completedAt: now,
          reason: payload.comments ?? null,
        },
      });
      if (claimed.count !== 1) {
        throw appError(
          "This approval step was already completed by another action",
          httpStatus.CONFLICT,
        );
      }

      const approval = await tx.approval.create({
        data: {
          workflowStepId: step.id,
          documentId: id,
          approverUserId: user.id,
          action: "APPROVE_AND_SIGN",
          comments: payload.comments ?? null,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent?.slice(0, 191) ?? null,
        },
      });

      await tx.signaturePlacement.create({
        data: {
          workflowStepId: step.id,
          approvalId: approval.id,
          signerUserId: user.id,
          signerName: signer.name,
          signerRoleSnapshot: signer.role,
          signatureStorageId,
          signatureProvider: (signer.signatureProvider ?? "LOCAL_SECURE") as StorageProviderValue,
          signatureUrl,
          signatureSha256,
          pageNumber: placement.pageNumber,
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          signedAt: now,
          ipAddress: ctx.ipAddress ?? null,
        },
      });

      if (outcome.kind === "ADVANCE" && outcome.nextStepOrder) {
        await tx.workflowStep.update({
          where: {
            workflowInstanceId_stepOrder: {
              workflowInstanceId: instance.id,
              stepOrder: outcome.nextStepOrder,
            },
          },
          data: { status: "ACTIVE", assignedAt: now, dueAt: computeStepDueAt(document.documentType.defaultSlaHours, now) },
        });
      }

      await tx.workflowInstance.update({
        where: { id: instance.id },
        data: {
          status: nextDocumentStatus,
          currentStepOrder: outcome.kind === "ADVANCE" ? outcome.nextStepOrder : instance.currentStepOrder,
          completedAt: outcome.kind === "FINALISE" ? now : null,
        },
      });

      await tx.document.update({
        where: { id },
        data:
          outcome.kind === "FINALISE"
            ? { status: "APPROVED", approvedAt: now, isLocked: true }
            : { status: nextDocumentStatus },
      });

      await recordAuditInTransaction(tx, {
        documentId: id,
        documentVersion: instance.documentVersion,
        workflowStepId: step.id,
        actorUserId: user.id,
        action: "APPROVED_AND_SIGNED",
        previousStatus: document.status,
        newStatus: nextDocumentStatus,
        metadata: {
          stepOrder: step.stepOrder,
          ofTotal: instance.totalSteps,
          placement: { page: placement.pageNumber, x: placement.x, y: placement.y },
          signatureSha256,
        },
        ipAddress: ctx.ipAddress,
      });
    },
    { timeout: 20_000 },
  );

  // ── Post-transaction side effects (never inside the transaction) ──
  if (outcome.kind === "FINALISE") {
    // The approval is already committed, so a finalisation failure must NOT
    // propagate as a 5xx: the approver would see an error and, on retry, only
    // get "already completed". Record the failure and surface it in the payload
    // so the problem is visible and recoverable instead of being a dead end.
    try {
      await finaliseDocument(id, user, ctx);
    } catch (error) {
      logger.error({ err: error, documentId: id }, "final PDF generation failed; document is APPROVED without a signed PDF");
      await recordAudit({
        documentId: id,
        documentVersion: instance.documentVersion,
        workflowStepId: step.id,
        actorUserId: user.id,
        action: "SIGNATURE_PLACEMENT_FAILED",
        newStatus: "APPROVED",
        reason:
          "All approvals completed but the final signed PDF could not be generated. " +
          "The document is approved and locked; re-run finalisation to produce the PDF.",
        metadata: { error: error instanceof Error ? error.message : String(error) },
        ipAddress: ctx.ipAddress,
      }).catch(() => undefined);
    }
  } else if (outcome.kind === "ADVANCE" && outcome.nextStepOrder) {
    const nextStep = instance.steps.find((s) => s.stepOrder === outcome.nextStepOrder);
    if (nextStep) {
      await notifyUser({
        type: NotificationType.DOCUMENT_APPROVED,
        title: "Action required: review and sign",
        message: `${signer.name} approved step ${step.stepOrder} of "${document.title}" (${document.documentNumber}). It is now with you.`,
        userId: nextStep.approverUserId,
        documentId: id,
        branchId: document.branchId,
        actorUserId: user.id,
      });
    }
  }

  await invalidateDocumentCaches();
  publishDataChanged("document.approved", { type: "global" });

  return getDocumentById(id, user, ctx);
}

/** Reject: terminates the cycle. The reason is permanently attached to it. */
export async function rejectDocument(
  id: number,
  payload: RejectDocumentInput,
  user: AuthUser,
  ctx: RequestContext = {},
) {
  const { document, instance, step } = await loadActiveStep(id, user);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.workflowStep.updateMany({
      where: { id: step.id, status: "ACTIVE", approverUserId: user.id },
      data: { status: "REJECTED", completedAt: now, reason: payload.reason },
    });
    if (claimed.count !== 1) {
      throw appError("This approval step was already completed by another action", httpStatus.CONFLICT);
    }

    await tx.approval.create({
      data: {
        workflowStepId: step.id,
        documentId: id,
        approverUserId: user.id,
        action: "REJECT",
        comments: payload.reason,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent?.slice(0, 191) ?? null,
      },
    });

    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: { status: "REJECTED", completedAt: now, terminatedReason: payload.reason },
    });
    await tx.document.update({ where: { id }, data: { status: "REJECTED" } });

    await recordAuditInTransaction(tx, {
      documentId: id,
      documentVersion: instance.documentVersion,
      workflowStepId: step.id,
      actorUserId: user.id,
      action: "REJECTED",
      previousStatus: document.status,
      newStatus: "REJECTED",
      reason: payload.reason,
      metadata: { stepOrder: step.stepOrder, ofTotal: instance.totalSteps },
      ipAddress: ctx.ipAddress,
    });
  });

  await notifyUser({
    type: NotificationType.DOCUMENT_REJECTED,
    title: "Document rejected",
    message: `${user.name} rejected "${document.title}" (${document.documentNumber}) at step ${step.stepOrder}. Reason: ${payload.reason}`,
    userId: document.createdByUserId,
    documentId: id,
    branchId: document.branchId,
    actorUserId: user.id,
  });

  await invalidateDocumentCaches();
  publishDataChanged("document.rejected", { type: "global" });

  return getDocumentById(id, user, ctx);
}

/**
 * Request changes: returns the document to its creator. The version, its file
 * and every signature already collected are preserved untouched.
 */
export async function requestChanges(
  id: number,
  payload: RequestChangesInput,
  user: AuthUser,
  ctx: RequestContext = {},
) {
  const { document, instance, step } = await loadActiveStep(id, user);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.workflowStep.updateMany({
      where: { id: step.id, status: "ACTIVE", approverUserId: user.id },
      data: { status: "RETURNED_FOR_REVISION", completedAt: now, reason: payload.reason },
    });
    if (claimed.count !== 1) {
      throw appError("This approval step was already completed by another action", httpStatus.CONFLICT);
    }

    await tx.approval.create({
      data: {
        workflowStepId: step.id,
        documentId: id,
        approverUserId: user.id,
        action: "REQUEST_CHANGES",
        comments: payload.reason,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent?.slice(0, 191) ?? null,
      },
    });

    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: { status: "RETURNED_FOR_REVISION", completedAt: now, terminatedReason: payload.reason },
    });
    await tx.document.update({ where: { id }, data: { status: "RETURNED_FOR_REVISION" } });

    await recordAuditInTransaction(tx, {
      documentId: id,
      documentVersion: instance.documentVersion,
      workflowStepId: step.id,
      actorUserId: user.id,
      action: "CHANGES_REQUESTED",
      previousStatus: document.status,
      newStatus: "RETURNED_FOR_REVISION",
      reason: payload.reason,
      metadata: { stepOrder: step.stepOrder, ofTotal: instance.totalSteps },
      ipAddress: ctx.ipAddress,
    });
  });

  await notifyUser({
    type: NotificationType.DOCUMENT_CHANGES_REQUESTED,
    title: "Changes requested",
    message: `${user.name} requested changes on "${document.title}" (${document.documentNumber}). Reason: ${payload.reason}`,
    userId: document.createdByUserId,
    documentId: id,
    branchId: document.branchId,
    actorUserId: user.id,
  });

  await invalidateDocumentCaches();
  publishDataChanged("document.changes-requested", { type: "global" });

  return getDocumentById(id, user, ctx);
}

// ─── Finalisation ─────────────────────────────────────────────────────────────

/**
 * Generates, stores and locks the final signed PDF.
 *
 * Runs outside the approval transaction on purpose: PDF rendering and object
 * storage are slow, and a failure here must leave the completed approvals
 * intact and retryable rather than rolling the workflow back.
 */
async function finaliseDocument(id: number, user: AuthUser, ctx: RequestContext) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);

  const version = document.versions[0];
  if (!version) throw appError("The approved version is missing", httpStatus.INTERNAL_SERVER_ERROR);

  const [sourceFile, placements] = await Promise.all([
    prisma.documentFile.findFirst({
      where: { versionId: version.id, kind: "SOURCE" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.signaturePlacement.findMany({
      where: { approval: { documentId: id, workflowStep: { workflowInstance: { versionId: version.id } } } },
      orderBy: { signedAt: "asc" },
    }),
  ]);

  if (!sourceFile) {
    logger.error({ documentId: id }, "approved document has no source file");
    throw appError("The approved document file could not be located", httpStatus.INTERNAL_SERVER_ERROR);
  }

  const signatures = await Promise.all(
    placements.map(async (placement) => {
      // Read the asset frozen into the placement, NOT the signer's current
      // profile signature — a later profile change must never rewrite history.
      // The provider is frozen too, so the bytes stay reachable even if the
      // deployment switches storage backend.
      let bytes: Buffer = Buffer.alloc(0);
      if (placement.signatureStorageId && !placement.signatureStorageId.startsWith("text-only-")) {
        try {
          bytes = await readStoredAsset({
            provider: placement.signatureProvider as StorageProviderValue,
            storageId: placement.signatureStorageId,
            resourceType: "image",
          });
        } catch (error) {
          logger.warn({ err: error, signerId: placement.signerUserId }, "signature snapshot unavailable; stamping name only");
        }
      }
      return {
        signerName: placement.signerName,
        signerRole: placement.signerRoleSnapshot,
        pageNumber: placement.pageNumber,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        signatureBytes: bytes,
        signedAt: placement.signedAt,
      };
    }),
  );

  const pdf = await generateFinalSignedPdf({
    documentNumber: document.documentNumber,
    title: document.title,
    versionNumber: version.versionNumber,
    description: document.description,
    source: {
      provider: sourceFile.storageProvider,
      storageId: sourceFile.storageId,
      resourceType: sourceFile.resourceType,
      mimeType: sourceFile.mimeType,
      fileName: sourceFile.originalFileName,
    },
    signatures,
  });

  const fileName = `${document.documentNumber}-v${version.versionNumber}-SIGNED.pdf`;
  const stored = await storeBuffer(
    pdf.bytes,
    `documents/${document.id}/final`,
    fileName,
    "application/pdf",
    "raw",
  );

  await prisma.$transaction(async (tx) => {
    await tx.documentFile.create({
      data: {
        documentId: document.id,
        versionId: version.id,
        kind: "FINAL_SIGNED",
        originalFileName: fileName,
        mimeType: "application/pdf",
        fileSize: stored.bytes,
        storageProvider: stored.provider,
        storageId: stored.storageId,
        resourceType: stored.resourceType,
        format: "pdf",
        checksum: pdf.checksum,
        pageCount: pdf.pageCount,
      },
    });
    await tx.document.update({ where: { id }, data: { status: "APPROVED", isLocked: true } });
    await recordAuditInTransaction(tx, {
      documentId: document.id,
      documentVersion: version.versionNumber,
      actorUserId: user.id,
      action: "FINAL_PDF_GENERATED",
      previousStatus: "APPROVED",
      newStatus: "APPROVED",
      metadata: {
        fileName,
        pageCount: pdf.pageCount,
        signatureCount: pdf.signatureCount,
        checksum: pdf.checksum,
      },
      ipAddress: ctx.ipAddress,
    });
    await recordAuditInTransaction(tx, {
      documentId: document.id,
      documentVersion: version.versionNumber,
      actorUserId: user.id,
      action: "DOCUMENT_LOCKED",
      newStatus: "APPROVED",
      reason: "Final signed PDF generated. Any further change requires a new version.",
    });
  });

  await notifyUser({
    type: NotificationType.DOCUMENT_FINAL_APPROVED,
    title: "Document fully approved and locked",
    message: `All approvers signed "${document.title}" (${document.documentNumber}). The final signed PDF has been generated.`,
    userId: document.createdByUserId,
    documentId: document.id,
    branchId: document.branchId,
    actorUserId: user.id,
  });
}

// ─── Revision ─────────────────────────────────────────────────────────────────

/**
 * Creates the next version. Every new version starts a brand-new approval cycle
 * from the first approver — earlier approvals are never reused, because a
 * revised document may have changed the content they approved.
 */
export async function createRevision(
  id: number,
  meta: ReviseDocumentMetaInput,
  upload: Express.Multer.File,
  user: AuthUser,
  ctx: RequestContext = {},
) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  if (document.createdByUserId !== user.id) {
    throw appError("Only the creator can create a new version", httpStatus.FORBIDDEN);
  }
  if (!["RETURNED_FOR_REVISION", "REJECTED", "APPROVED"].includes(document.status)) {
    throw appError(
      "A new version can only be created after changes are requested, a rejection, or final approval",
      httpStatus.CONFLICT,
    );
  }

  const nextVersionNumber = document.currentVersion + 1;
  const pageCount = await detectPageCount(upload);

  const version = await prisma.documentVersion.create({
    data: {
      documentId: id,
      versionNumber: nextVersionNumber,
      changeSummary: meta.changeSummary,
      notes: meta.notes ?? null,
      pageCount,
      createdByUserId: user.id,
    },
  });

  let asset: StoredAsset;
  try {
    asset = await storeBuffer(
      upload.buffer,
      `documents/${id}/v${nextVersionNumber}`,
      upload.originalname,
      upload.mimetype,
    );
  } catch (error) {
    await prisma.documentVersion.delete({ where: { id: version.id } }).catch(() => undefined);
    throw error;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.documentFile.create({
        data: {
          documentId: id,
          versionId: version.id,
          kind: "SOURCE",
          originalFileName: upload.originalname.slice(0, 191),
          mimeType: upload.mimetype,
          fileSize: asset.bytes,
          storageProvider: asset.provider,
          storageId: asset.storageId,
          resourceType: asset.resourceType,
          format: asset.format,
          checksum: asset.checksum,
          pageCount,
        },
      });

      await tx.document.update({
        where: { id },
        data: { currentVersion: nextVersionNumber, status: "DRAFT", isLocked: false },
      });

      // Inside the transaction: the trail must match the state it describes.
      await recordAuditInTransaction(tx, {
        documentId: id,
        documentVersion: nextVersionNumber,
        actorUserId: user.id,
        action: "REVISION_CREATED",
        previousStatus: document.status,
        newStatus: "DRAFT",
        reason: meta.changeSummary,
        metadata: { basedOnVersion: document.currentVersion, fileName: upload.originalname },
        ipAddress: ctx.ipAddress,
      });
    });
  } catch (error) {
    // Roll the whole revision back and drop the orphaned bytes.
    await prisma.document.update({
      where: { id },
      data: { currentVersion: document.currentVersion, status: document.status, isLocked: document.isLocked },
    });
    await prisma.documentVersion.delete({ where: { id: version.id } }).catch(() => undefined);
    await deleteStoredAsset({
      provider: asset.provider,
      storageId: asset.storageId,
      resourceType: asset.resourceType,
    });
    throw error;
  }

  await notifyUser({
    type: NotificationType.DOCUMENT_REVISION_CREATED,
    title: "New version created",
    message: `${user.name} created version ${nextVersionNumber} of "${document.title}" (${document.documentNumber}). Approval will restart from the first approver.`,
    userId: document.createdByUserId,
    documentId: id,
    branchId: document.branchId,
    actorUserId: user.id,
  });

  await invalidateDocumentCaches();
  publishDataChanged("document.revised", { type: "global" });

  return getDocumentById(id, user, ctx);
}

// ─── Cancel / archive ─────────────────────────────────────────────────────────

export async function cancelDocument(
  id: number,
  payload: CancelDocumentInput,
  user: AuthUser,
  ctx: RequestContext = {},
) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
    include: { workflowInstances: { where: { status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] } }, select: { id: true } } },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);

  const isCreator = document.createdByUserId === user.id;
  const isAdmin = user.role === "SUPER_ADMIN" || user.role === "ADMIN";
  if (!isCreator && !isAdmin) {
    throw appError("Only the creator or an administrator can cancel this document", httpStatus.FORBIDDEN);
  }
  if (!isValidStatusTransition(document.status, "CANCELLED")) {
    throw appError(`A document with status ${document.status} cannot be cancelled`, httpStatus.CONFLICT);
  }

  await prisma.$transaction(async (tx) => {
    if (document.workflowInstances.length) {
      await tx.workflowInstance.updateMany({
        where: { id: { in: document.workflowInstances.map((i) => i.id) } },
        data: { status: "CANCELLED", completedAt: new Date(), terminatedReason: payload.reason },
      });
    }
    await tx.document.update({ where: { id }, data: { status: "CANCELLED" } });
    await recordAuditInTransaction(tx, {
      documentId: id,
      documentVersion: document.currentVersion,
      actorUserId: user.id,
      action: "DOCUMENT_CANCELLED",
      previousStatus: document.status,
      newStatus: "CANCELLED",
      reason: payload.reason,
      ipAddress: ctx.ipAddress,
    });
  });

  await invalidateDocumentCaches();
  publishDataChanged("document.cancelled", { type: "global" });

  return getDocumentById(id, user, ctx);
}

export async function archiveDocument(id: number, user: AuthUser, ctx: RequestContext = {}) {
  const document = await prisma.document.findFirst({ where: { id, isDeleted: false } });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  if (document.status !== "APPROVED") {
    throw appError("Only an approved document can be archived", httpStatus.CONFLICT);
  }
  if (user.role !== "SUPER_ADMIN" && document.createdByUserId !== user.id) {
    throw appError("Only the creator or a Super Admin can archive this document", httpStatus.FORBIDDEN);
  }

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await recordAuditInTransaction(tx, {
      documentId: id,
      documentVersion: document.currentVersion,
      actorUserId: user.id,
      action: "DOCUMENT_ARCHIVED",
      previousStatus: "APPROVED",
      newStatus: "ARCHIVED",
      ipAddress: ctx.ipAddress,
    });
  });

  await invalidateDocumentCaches();
  publishDataChanged("document.archived", { type: "global" });

  return getDocumentById(id, user, ctx);
}

/** Soft delete. Only the creator or a Super Admin may remove a document. */
export async function deleteDocument(id: number, user: AuthUser) {
  const document = await prisma.document.findFirst({ where: { id, isDeleted: false } });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  if (document.createdByUserId !== user.id && user.role !== "SUPER_ADMIN") {
    throw appError("Only the creator or a Super Admin can delete this document", httpStatus.FORBIDDEN);
  }
  if (document.status === "IN_REVIEW") {
    throw appError("A document that is currently in review cannot be deleted", httpStatus.CONFLICT);
  }

  await prisma.document.update({ where: { id }, data: { isDeleted: true } });
  await invalidateDocumentCaches();
  publishDataChanged("document.deleted", { type: "global" });
  return { id };
}

// ─── File access ──────────────────────────────────────────────────────────────

/**
 * Streams a stored file to an authorised caller.
 *
 * The caller must have document-level permission first — this function is only
 * reached after that check in the controller.
 */
export async function getFileDownload(fileId: number, user: AuthUser) {
  const file = await prisma.documentFile.findUnique({
    where: { id: fileId },
    include: { document: { select: { id: true, createdByUserId: true, isDeleted: true } } },
  });
  if (!file || file.document.isDeleted) throw appError("File not found", httpStatus.NOT_FOUND);

  assertCanView(file.document, user, await approverIdsForDocument(file.document.id));

  const target = await resolveDownload(
    { provider: file.storageProvider, storageId: file.storageId, resourceType: file.resourceType },
    file.originalFileName,
    file.mimeType,
  );
  return target;
}

/** Version history. Immutable by construction — nothing here can be edited. */
export async function getDocumentVersions(id: number, user: AuthUser) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, createdByUserId: true, currentVersion: true, status: true },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  assertCanView(document, user, await approverIdsForDocument(id));

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { versionNumber: "desc" },
    // Bounded: a document's version list must never be an unbounded read.
    take: MAX_VERSIONS_PER_DOCUMENT,
    include: {
      files: { select: FILE_SELECT },
      workflow: {
        select: {
          id: true,
          status: true,
          documentVersion: true,
          startedAt: true,
          completedAt: true,
          terminatedReason: true,
          steps: {
            orderBy: { stepOrder: "asc" },
            select: {
              stepOrder: true,
              status: true,
              approverNameSnapshot: true,
              approverRoleSnapshot: true,
              completedAt: true,
              reason: true,
            },
          },
        },
      },
    },
  });

  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    changeSummary: version.changeSummary,
    notes: version.notes,
    pageCount: version.pageCount,
    createdAt: version.createdAt.toISOString(),
    // Mirrors the detail payload so the Versions tab needs no second source.
    isOriginal: version.versionNumber === 1,
    isCurrent: version.versionNumber === document.currentVersion,
    isFinal: document.status === "APPROVED" && version.versionNumber === document.currentVersion,
    files: version.files.map(serialiseFile),
    workflow: version.workflow
      ? {
          status: version.workflow.status,
          startedAt: version.workflow.startedAt.toISOString(),
          completedAt: version.workflow.completedAt?.toISOString() ?? null,
          terminatedReason: version.workflow.terminatedReason,
          steps: version.workflow.steps.map((s) => ({
            stepOrder: s.stepOrder,
            status: s.status,
            approverName: s.approverNameSnapshot,
            approverRole: s.approverRoleSnapshot,
            completedAt: s.completedAt?.toISOString() ?? null,
            reason: s.reason,
          })),
        }
      : null,
  }));
}

export async function getDocumentWorkflow(id: number, user: AuthUser) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, createdByUserId: true, status: true },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  assertCanView(document, user, await approverIdsForDocument(id));

  const workflow = await loadWorkflow(id);
  return {
    documentId: id,
    status: document.status,
    workflow,
    instances: await prisma.workflowInstance.findMany({
      where: { documentId: id },
      orderBy: { documentVersion: "desc" },
      take: MAX_VERSIONS_PER_DOCUMENT,
      select: {
        id: true,
        documentVersion: true,
        status: true,
        currentStepOrder: true,
        totalSteps: true,
        startedAt: true,
        completedAt: true,
        terminatedReason: true,
      },
    }).then((rows) =>
      rows.map((r) => ({
        id: r.id,
        documentVersion: r.documentVersion,
        status: r.status,
        currentStepOrder: r.currentStepOrder,
        totalSteps: r.totalSteps,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        terminatedReason: r.terminatedReason,
      })),
    ),
  };
}

export async function getDocumentAuditTrail(id: number, user: AuthUser) {
  const document = await prisma.document.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, createdByUserId: true },
  });
  if (!document) throw appError("Document not found", httpStatus.NOT_FOUND);
  assertCanView(document, user, await approverIdsForDocument(id));
  return getDocumentAudit(id);
}

// ─── Approval inbox ───────────────────────────────────────────────────────────

/** Everything waiting on the signed-in user right now. */
export async function getPendingApprovals(query: ApprovalQueryInput, user: AuthUser) {
  const pagination = transformPagination(query);

  const where: Prisma.DocumentWhereInput = {
    isDeleted: false,
    status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] },
    workflowInstances: {
      some: {
        status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] },
        steps: { some: { approverUserId: user.id, status: "ACTIVE" } },
      },
    },
  };

  const [documents, total] = await prisma.$transaction([
    prisma.document.findMany({
      where,
      ...pagination,
      include: {
        documentType: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        createdBy: { select: USER_SELECT },
        workflowInstances: {
          where: { status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] } },
          orderBy: { documentVersion: "desc" },
          take: 1,
          include: {
            steps: {
              orderBy: { stepOrder: "asc" },
              select: { stepOrder: true, status: true, approverNameSnapshot: true, approverRoleSnapshot: true, dueAt: true },
            },
          },
        },
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    data: documents.map((doc) => {
      const instance = doc.workflowInstances[0];
      const active = instance?.steps.find((s) => s.status === "ACTIVE");
      return {
        id: doc.id,
        documentNumber: doc.documentNumber,
        title: doc.title,
        status: doc.status,
        currentVersion: doc.currentVersion,
        documentType: doc.documentType,
        branch: doc.branch,
        createdBy: doc.createdBy,
        submittedAt: doc.submittedAt?.toISOString() ?? null,
        updatedAt: doc.updatedAt.toISOString(),
        yourStep: active?.stepOrder ?? null,
        stepTotal: instance?.totalSteps ?? 0,
        approvedSoFar: instance?.steps.filter((s) => s.status === "APPROVED").length ?? 0,
        dueAt: active?.dueAt?.toISOString() ?? null,
        approverName: active?.approverNameSnapshot ?? user.name,
        approverRole: active?.approverRoleSnapshot ?? user.role,
      };
    }),
    meta: buildMetadata(total, pagination),
  };
}

/** Everything the signed-in user has already decided. */
export async function getApprovalHistory(query: ApprovalQueryInput, user: AuthUser) {
  const pagination = transformPagination(query);
  const where: Prisma.ApprovalWhereInput = { approverUserId: user.id };

  const [data, total] = await prisma.$transaction([
    prisma.approval.findMany({
      where,
      ...pagination,
      include: {
        document: {
          select: {
            id: true,
            documentNumber: true,
            title: true,
            status: true,
            currentVersion: true,
            documentType: { select: { name: true } },
          },
        },
        workflowStep: { select: { stepOrder: true, workflowInstance: { select: { documentVersion: true, totalSteps: true } } } },
        signature: { select: { pageNumber: true, x: true, y: true, signatureUrl: true, signedAt: true } },
      },
    }),
    prisma.approval.count({ where }),
  ]);

  return {
    data: data.map((approval) => ({
      id: approval.id,
      action: approval.action,
      comments: approval.comments,
      decidedAt: approval.createdAt.toISOString(),
      documentId: approval.document.id,
      documentNumber: approval.document.documentNumber,
      documentTitle: approval.document.title,
      documentStatus: approval.document.status,
      documentType: approval.document.documentType.name,
      documentVersion: approval.workflowStep.workflowInstance.documentVersion,
      stepOrder: approval.workflowStep.stepOrder,
      stepTotal: approval.workflowStep.workflowInstance.totalSteps,
      signature: approval.signature
        ? {
            pageNumber: approval.signature.pageNumber,
            x: approval.signature.x,
            y: approval.signature.y,
            url: approval.signature.signatureUrl,
            signedAt: approval.signature.signedAt.toISOString(),
          }
        : null,
    })),
    meta: buildMetadata(total, pagination),
  };
}

// ─── Directory & document types ───────────────────────────────────────────────

/** Active users that may be added to an approval sequence. */
export async function getApproverDirectory(search: string | undefined, limit = 50) {
  const users = await prisma.user.findMany({
    where: {
      isDeleted: false,
      isActive: true,
      ...(search
        ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] }
        : {}),
    },
    select: { ...USER_SELECT, signatureUrl: true },
    take: Math.min(Math.max(limit, 1), 200),
  });

  // Sort by REAL seniority, not the database enum's declaration order. The two
  // disagree (the enum puts BRANCH_MANAGER last, which made the approver picker
  // list branch managers as the most senior people in the company).
  return users
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      branchId: u.branchId,
      hasSignature: Boolean(u.signatureUrl),
    }))
    .sort(
      (a, b) =>
        hierarchyRank(b.role) - hierarchyRank(a.role) || a.name.localeCompare(b.name),
    );
}

export async function getDocumentTypes(includeInactive = false) {
  const types = await prisma.documentType.findMany({
    where: { isDeleted: false, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    // Bounded lookup: document types are a small master list, never unbounded.
    take: MAX_DOCUMENT_TYPES,
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      defaultSlaHours: true,
      sortOrder: true,
      isActive: true,
    },
  });
  return types;
}

export async function createDocumentType(
  input: { name: string; code: string; description?: string | null; defaultSlaHours?: number; sortOrder?: number },
) {
  const existing = await prisma.documentType.findUnique({ where: { code: input.code }, select: { id: true } });
  if (existing) throw appError("A document type with this code already exists", httpStatus.CONFLICT);
  return prisma.documentType.create({
    data: {
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      defaultSlaHours: input.defaultSlaHours ?? 48,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function updateDocumentType(
  id: number,
  input: Partial<{ name: string; code: string; description: string | null; defaultSlaHours: number; sortOrder: number; isActive: boolean }>,
) {
  const existing = await prisma.documentType.findFirst({ where: { id, isDeleted: false }, select: { id: true } });
  if (!existing) throw appError("Document type not found", httpStatus.NOT_FOUND);
  return prisma.documentType.update({ where: { id }, data: input });
}

export async function deleteDocumentType(id: number) {
  const type = await prisma.documentType.findFirst({ where: { id, isDeleted: false }, select: { id: true } });
  if (!type) throw appError("Document type not found", httpStatus.NOT_FOUND);

  const inUse = await prisma.document.count({ where: { documentTypeId: id, isDeleted: false } });
  if (inUse > 0) {
    throw appError(
      `This document type is used by ${inUse} document${inUse === 1 ? "" : "s"} and cannot be deleted. Deactivate it instead.`,
      httpStatus.CONFLICT,
    );
  }
  await prisma.documentType.update({ where: { id }, data: { isDeleted: true, isActive: false } });
  return { id };
}

/**
 * Reminder / escalation sweep for overdue steps.
 *
 * Deliberately an explicit, callable operation rather than a `setInterval`:
 * the deployment topology is unknown, so scheduling stays the caller's job
 * (cron, CI, a queue worker) while the logic lives here and is testable.
 */
export async function runSlaSweep() {
  const policy = await getDocumentPolicy();
  const now = Date.now();
  const reminderCutoff = new Date(now - policy.reminderAfterHours * 3600_000);
  const escalationCutoff = new Date(now - policy.escalateAfterHours * 3600_000);

  const overdue = await prisma.workflowStep.findMany({
    where: { status: "ACTIVE", dueAt: { lte: new Date(now) } },
    include: {
      workflowInstance: {
        select: {
          id: true,
          documentId: true,
          documentVersion: true,
          document: {
            select: { id: true, documentNumber: true, title: true, branchId: true, createdByUserId: true, createdBy: { select: { name: true } } },
          },
        },
      },
    },
    take: 500,
  });

  let reminders = 0;
  let escalations = 0;

  for (const step of overdue) {
    const { document } = step.workflowInstance;
    if (!step.dueAt) continue;

    if (step.escalatedAt === null && step.dueAt <= escalationCutoff) {
      await prisma.workflowStep.update({ where: { id: step.id }, data: { escalatedAt: new Date() } });
      const admins = await prisma.user.findMany({
        where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, isActive: true, isDeleted: false },
        select: { id: true },
      });
      const delivered = await notifyUsers(
        admins.map((a) => ({
          type: NotificationType.DOCUMENT_ESCALATED,
          title: "Approval overdue — escalation",
          message: `"${document.title}" (${document.documentNumber}) has been waiting on step ${step.stepOrder} for more than ${policy.escalateAfterHours} hours.`,
          userId: a.id,
          documentId: document.id,
          branchId: document.branchId,
          actorUserId: null,
        })),
      );
      escalations += delivered;
      continue;
    }

    if (step.remindedAt === null && step.dueAt <= reminderCutoff) {
      await prisma.workflowStep.update({ where: { id: step.id }, data: { remindedAt: new Date() } });
      const delivered = await notifyUsers([
        {
          type: NotificationType.DOCUMENT_REMINDER,
          title: "Reminder: approval pending",
          message: `"${document.title}" (${document.documentNumber}) is still waiting for your approval at step ${step.stepOrder}.`,
          userId: step.approverUserId,
          documentId: document.id,
          branchId: document.branchId,
          actorUserId: null,
        },
      ]);
      reminders += delivered;
    }
  }

  return { scanned: overdue.length, reminders, escalations, policy };
}

/** Storage diagnostics for the administration screen. */
export async function getStorageInfo() {
  return { provider: activeProvider(), cloudinaryConfigured: activeProvider() === "CLOUDINARY" };
}

export type { DocumentStatus };