import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { formatDateOnly, toDateOnly, toEndOfDay } from "../../utils/dateHelpers";
import { publishDataChanged } from "../../lib/realtime";
import { withCache, invalidateByPrefix } from "../../lib/cache";
import * as notificationService from "../notification/notification.service";
import { NotificationType } from "../../../generated/prisma/enums";
import {
  CreateManagerReportInput,
  UpdateManagerReportInput,
  ManagerReportQueryInput,
  ApprovalStatusInput,
  CreateManagerReportCommentInput,
} from "./manager-report.validation";

interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
}

const REPORT_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  approvedBy: { select: { id: true, name: true } },
  complaints: true,
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { user: { select: { id: true, name: true, role: true } } },
  },
} satisfies Prisma.ManagerReportInclude;

// List reads hit a remote, high-latency DB on every dashboard render +
// realtime refresh. Reports change rarely (a handful of mutations per day), so
// a short cache avoids re-round-tripping the whole table; mutations below
// invalidate the prefix.
const REPORTS_LIST_PREFIX = "managerReports_";
const REPORTS_LIST_TTL = 20;

function reportsListKey(query: ManagerReportQueryInput, user: AuthUser): string {
  const scope = user.role === "BRANCH_MANAGER" ? `bm_${user.branchId ?? "none"}` : "all";
  return `${REPORTS_LIST_PREFIX}${scope}:${JSON.stringify(query)}`;
}

async function invalidateReportsListCaches(): Promise<void> {
  await invalidateByPrefix(REPORTS_LIST_PREFIX);
}

function formatReport<T extends { reportDate: Date }>(report: T): T {
  return { ...report, reportDate: formatDateOnly(report.reportDate) } as T;
}
function resolveBranchId(payloadBranchId: number | undefined, user: AuthUser): number {
  if (user.role === "BRANCH_MANAGER") {
    if (!user.branchId) throw appError("No branch is assigned to your account", httpStatus.FORBIDDEN);
    if (payloadBranchId && payloadBranchId !== user.branchId) {
      throw appError("Forbidden: You can only create reports for your own branch", httpStatus.FORBIDDEN);
    }
    return user.branchId;
  }
  if (!payloadBranchId) throw appError("branchId is required", httpStatus.BAD_REQUEST);
  return payloadBranchId;
}

interface ComplaintDraftInput {
  guestName?: string;
  mobile?: string;
  email?: string | null;
  complaintDetails?: string;
  serviceProviderName?: string;
  responsiblePerson?: string;
  actionTaken?: string;
  solution?: string;
}

/**
 * Normalize complaint drafts for storage. Every field is optional, so
 * fully-empty rows (added by accident) are dropped instead of saved.
 */
function toComplaintRows(complaints: ComplaintDraftInput[] | undefined) {
  return (complaints ?? [])
    .map((c) => ({
      guestName: c.guestName ?? "",
      mobile: c.mobile ?? "",
      email: c.email ?? null,
      complaintDetails: c.complaintDetails ?? "",
      serviceProviderName: c.serviceProviderName ?? "",
      responsiblePerson: c.responsiblePerson ?? "",
      actionTaken: c.actionTaken ?? "",
      solution: c.solution ?? "",
    }))
    .filter(
      (c) =>
        c.guestName !== "" ||
        c.mobile !== "" ||
        c.complaintDetails !== "" ||
        c.actionTaken !== "" ||
        c.solution !== "",
    );
}

export async function createReport(payload: CreateManagerReportInput, user: AuthUser) {
  const branchId = resolveBranchId(payload.branchId, user);
  const reportDate = toDateOnly(payload.reportDate);

  const existing = await prisma.managerReport.findUnique({
    where: { branchId_reportDate: { branchId, reportDate } },
    select: { id: true, isDeleted: true },
  });
  if (existing && !existing.isDeleted) {
    throw appError("A manager report already exists for this branch on this date", httpStatus.CONFLICT);
  }

  const complaintsData = toComplaintRows(payload.complaints);
  const baseData: Prisma.ManagerReportUncheckedCreateInput = {
    branchId,
    managerName: payload.managerName,
    reportDate,
    managerComments: payload.managerComments ?? "",
    supplyPurchaseIssues: payload.supplyPurchaseIssues ?? "",
    briefingPoints: payload.briefingPoints ?? "",
    dailyLearnings: payload.dailyLearnings ?? "",
    createdByUserId: user.id,
    complaints: { create: complaintsData },
  };

  if (existing && existing.isDeleted) {
    const data: Prisma.ManagerReportUncheckedUpdateInput = {
      ...baseData,
      isDeleted: false,
      approvalStatus: "PENDING",
      approvedByUserId: null,
      approvedAt: null,
      complaints: { deleteMany: {}, create: complaintsData },
    };
    const report = await prisma.$transaction((tx) =>
      tx.managerReport.update({
        where: { id: existing.id },
        data,
        include: REPORT_INCLUDE,
      }),
    );
    publishDataChanged("manager-report.created", { type: "branch", branchId });
    await invalidateReportsListCaches();
    if (user.role === "BRANCH_MANAGER") {
      await notificationService.createSubmissionNotification({
        type: NotificationType.MANAGER_REPORT_SUBMITTED,
        title: "Daily report submitted",
        message: `${report.managerName} submitted the daily report for ${report.branch.name} (${formatDateOnly(reportDate)})`,
        branchId,
        entityId: report.id,
        actorUserId: user.id,
      });
    }
    return formatReport(report);
  }

  const report = await prisma.$transaction((tx) =>
    tx.managerReport.create({
      data: baseData,
      include: REPORT_INCLUDE,
    }),
  );

  publishDataChanged("manager-report.created", { type: "branch", branchId });
  await invalidateReportsListCaches();
  if (user.role === "BRANCH_MANAGER") {
    await notificationService.createSubmissionNotification({
      type: NotificationType.MANAGER_REPORT_SUBMITTED,
      title: "Daily report submitted",
      message: `${report.managerName} submitted the daily report for ${report.branch.name} (${formatDateOnly(reportDate)})`,
      branchId,
      entityId: report.id,
      actorUserId: user.id,
    });
  }
  return formatReport(report);
}

export async function getPaginatedReports(query: ManagerReportQueryInput, user: AuthUser) {
  return withCache(reportsListKey(query, user), async () => {
    const pagination = transformPagination(query);
    const where: Prisma.ManagerReportWhereInput = { isDeleted: false };

    if (user.role === "BRANCH_MANAGER") {
      where.branchId = user.branchId ?? undefined;
    } else if (query.branchId) {
      where.branchId = Number(query.branchId);
    }
    if (query.managerName) where.managerName = { contains: query.managerName };
    if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
    if (query.startDate || query.endDate) {
      const dateFilter: Prisma.DateTimeFilter<"ManagerReport"> = {};
      if (query.startDate) dateFilter.gte = toDateOnly(query.startDate);
      if (query.endDate) dateFilter.lte = toEndOfDay(query.endDate);
      where.reportDate = dateFilter;
    }

    const [data, total] = await prisma.$transaction([
      prisma.managerReport.findMany({
        where,
        ...pagination,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          _count: { select: { complaints: true } },
        },
      }),
      prisma.managerReport.count({ where }),
    ]);

    return { data: data.map(formatReport), meta: buildMetadata(total, pagination) };
  }, REPORTS_LIST_TTL);
}

export async function getReportById(id: number, user: AuthUser) {
  const report = await prisma.managerReport.findUnique({ where: { id }, include: REPORT_INCLUDE });
  if (!report || report.isDeleted) throw appError("Manager report not found", httpStatus.NOT_FOUND);
  if (user.role === "BRANCH_MANAGER" && report.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this report", httpStatus.FORBIDDEN);
  }
  return formatReport(report);
}

export async function getReportSummary(user: AuthUser) {
  return withCache(`${REPORTS_LIST_PREFIX}summary_${user.role}_${user.branchId ?? "all"}`, async () => {
    const baseWhere: Prisma.ManagerReportWhereInput = { isDeleted: false };
    if (user.role === "BRANCH_MANAGER") {
      baseWhere.branchId = user.branchId ?? undefined;
    }

    const [total, pending, approved, rejected] = await Promise.all([
      prisma.managerReport.count({ where: baseWhere }),
      prisma.managerReport.count({ where: { ...baseWhere, approvalStatus: "PENDING" } }),
      prisma.managerReport.count({ where: { ...baseWhere, approvalStatus: "APPROVED" } }),
      prisma.managerReport.count({ where: { ...baseWhere, approvalStatus: "REJECTED" } }),
    ]);

    return { total, pending, approved, rejected };
  }, REPORTS_LIST_TTL);
}

export async function updateReport(id: number, payload: UpdateManagerReportInput, user: AuthUser) {
  const existing = await prisma.managerReport.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw appError("Manager report not found", httpStatus.NOT_FOUND);

  if (user.role === "BRANCH_MANAGER") {
    if (existing.branchId !== user.branchId) {
      throw appError("Forbidden: You can only edit reports for your own branch", httpStatus.FORBIDDEN);
    }
    if (existing.approvalStatus === "APPROVED") {
      throw appError("Approved reports cannot be edited", httpStatus.CONFLICT);
    }
  }

  const targetDate = payload.reportDate !== undefined ? toDateOnly(payload.reportDate) : existing.reportDate;

  if (targetDate.getTime() !== existing.reportDate.getTime()) {
    const conflict = await prisma.managerReport.findUnique({
      where: { branchId_reportDate: { branchId: existing.branchId, reportDate: targetDate } },
      select: { id: true },
    });
    if (conflict && conflict.id !== id) {
      throw appError("A manager report already exists for this branch on this date", httpStatus.CONFLICT);
    }
  }

  const data: Prisma.ManagerReportUncheckedUpdateInput = {};
  if (payload.managerName !== undefined) data.managerName = payload.managerName;
  if (payload.reportDate !== undefined) data.reportDate = targetDate;
  if (payload.managerComments !== undefined) data.managerComments = payload.managerComments;
  if (payload.supplyPurchaseIssues !== undefined) data.supplyPurchaseIssues = payload.supplyPurchaseIssues;
  if (payload.briefingPoints !== undefined) data.briefingPoints = payload.briefingPoints;
  if (payload.dailyLearnings !== undefined) data.dailyLearnings = payload.dailyLearnings;

  if (payload.complaints !== undefined) {
    data.complaints = {
      deleteMany: {},
      create: toComplaintRows(payload.complaints),
    };
  }
  if (user.role === "BRANCH_MANAGER" && existing.approvalStatus === "REJECTED") {
    data.approvalStatus = "PENDING";
    data.approvedByUserId = null;
    data.approvedAt = null;
    data.approvalComment = null;
  }

  const report = await prisma.$transaction((tx) =>
    tx.managerReport.update({ where: { id }, data, include: REPORT_INCLUDE }),
  );

  publishDataChanged("manager-report.updated", { type: "branch", branchId: existing.branchId });
  await invalidateReportsListCaches();
  if (user.role === "BRANCH_MANAGER" && existing.approvalStatus === "REJECTED") {
    await notificationService.createSubmissionNotification({
      type: NotificationType.MANAGER_REPORT_SUBMITTED,
      title: "Daily report resubmitted",
      message: `${report.managerName} resubmitted the daily report for ${report.branch.name} (${formatDateOnly(targetDate)})`,
      branchId: existing.branchId,
      entityId: report.id,
      actorUserId: user.id,
    });
  }
  return formatReport(report);
}

export async function deleteReport(id: number, user: AuthUser) {
  const existing = await prisma.managerReport.findUnique({
    where: { id },
    select: { branchId: true, isDeleted: true, approvalStatus: true },
  });
  if (!existing || existing.isDeleted) throw appError("Manager report not found", httpStatus.NOT_FOUND);
  if (user.role === "BRANCH_MANAGER" && existing.branchId !== user.branchId) {
    throw appError("Forbidden: You can only delete reports for your own branch", httpStatus.FORBIDDEN);
  }
  // Approved reports are protected — only Super Admin can remove them.
  if (existing.approvalStatus === "APPROVED" && user.role !== "SUPER_ADMIN") {
    throw appError("Forbidden: Only Super Admin can delete approved reports", httpStatus.FORBIDDEN);
  }
  const report = await prisma.managerReport.update({
    where: { id },
    data: { isDeleted: true },
  });
  publishDataChanged("manager-report.deleted", { type: "branch", branchId: existing.branchId });
  await invalidateReportsListCaches();
  return report;
}

export async function setReportApproval(id: number, payload: ApprovalStatusInput, user: AuthUser) {
  const existing = await prisma.managerReport.findUnique({
    where: { id },
    select: { approvalStatus: true, isDeleted: true, branchId: true },
  });
  if (!existing || existing.isDeleted) throw appError("Manager report not found", httpStatus.NOT_FOUND);
  if (existing.approvalStatus === "APPROVED") throw appError("This report is already approved", httpStatus.CONFLICT);

  // Stamp the approver's signature image on approval (e.g. COO sign).
  // Snapshotted onto the record so it survives later profile changes.
  const approver = await prisma.user.findUnique({ where: { id: user.id }, select: { signatureUrl: true } });

  const report = await prisma.managerReport.update({
    where: { id },
    data: {
      approvalStatus: payload.approvalStatus,
      approvedByUserId: user.id,
      approvedAt: new Date(),
      approvalComment: payload.approvalStatus === "REJECTED" ? (payload.approvalComment || null) : null,
      approvedSignature: payload.approvalStatus === "APPROVED" ? (approver?.signatureUrl ?? null) : null,
    },
    include: REPORT_INCLUDE,
  });

  publishDataChanged("manager-report.approved", { type: "branch", branchId: existing.branchId });
  await invalidateReportsListCaches();
  return formatReport(report);
}

export async function getReportComments(id: number, user: AuthUser) {
  const report = await prisma.managerReport.findUnique({
    where: { id },
    select: { isDeleted: true, branchId: true },
  });
  if (!report || report.isDeleted) throw appError("Manager report not found", httpStatus.NOT_FOUND);
  if (user.role === "BRANCH_MANAGER" && report.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this report", httpStatus.FORBIDDEN);
  }

  return prisma.managerReportComment.findMany({
    where: { reportId: id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
}

export async function addReportComment(id: number, payload: CreateManagerReportCommentInput, user: AuthUser) {
  const report = await prisma.managerReport.findUnique({
    where: { id },
    select: { isDeleted: true, branchId: true },
  });
  if (!report || report.isDeleted) throw appError("Manager report not found", httpStatus.NOT_FOUND);

  const comment = await prisma.managerReportComment.create({
    data: { reportId: id, userId: user.id, comment: payload.comment },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  publishDataChanged("manager-report.commented", { type: "branch", branchId: report.branchId });
  await invalidateReportsListCaches();
  return comment;
}
