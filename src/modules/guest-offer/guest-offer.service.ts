import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { formatDateOnly, toDateOnly, toEndOfDay } from "../../utils/dateHelpers";
import { resolveBranchScope, roundMoney } from "../../utils/accessScope";
import {
  GuestDiscountCreateInput,
  GuestDiscountUpdateInput,
  GuestEntertainmentCreateInput,
  GuestEntertainmentUpdateInput,
  ApprovalStatusInput,
  GuestOfferQueryInput,
} from "./guest-offer.validation";

interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
}

function isManager(user: AuthUser): boolean {
  return user.role === "BRANCH_MANAGER";
}

function formatLog<T extends { logDate: Date; totalBill?: unknown; discountPercent?: unknown; discountAmount?: unknown; foodCost?: unknown }>(log: T): T {
  return {
    ...log,
    logDate: formatDateOnly(log.logDate),
    totalBill: log.totalBill !== undefined ? Number(log.totalBill) : undefined,
    discountPercent: log.discountPercent !== undefined ? Number(log.discountPercent) : undefined,
    discountAmount: log.discountAmount !== undefined ? Number(log.discountAmount) : undefined,
    foodCost: log.foodCost !== undefined ? Number(log.foodCost) : undefined,
  } as T;
}

function buildDateFilter(query: GuestOfferQueryInput): { gte?: Date; lte?: Date } {
  const filter: { gte?: Date; lte?: Date } = {};
  if (query.logDate) {
    filter.gte = toDateOnly(query.logDate);
    filter.lte = toEndOfDay(query.logDate);
  } else {
    if (query.startDate) filter.gte = toDateOnly(query.startDate);
    if (query.endDate) filter.lte = toEndOfDay(query.endDate);
  }
  return filter;
}

// ─── Discount logs ────────────────────────────────────────────────────────────

export async function createDiscountLog(payload: GuestDiscountCreateInput, user: AuthUser) {
  const branchId = resolveBranchScope(payload.branchId, user);
  const discountAmount = roundMoney((payload.totalBill * payload.discountPercent) / 100);

  const log = await prisma.guestDiscountLog.create({
    data: {
      branchId,
      logDate: toDateOnly(payload.logDate),
      guestName: payload.guestName,
      mobile: payload.mobile,
      hadLunch: payload.hadLunch ?? false,
      hadDinner: payload.hadDinner ?? false,
      totalBill: payload.totalBill,
      discountPercent: payload.discountPercent,
      discountAmount,
      reasonForDiscount: payload.reasonForDiscount,
      offeredByUserId: user.id,
    },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      offeredBy: { select: { id: true, name: true } },
    },
  });

  return formatLog(log);
}

export async function getPaginatedDiscountLogs(query: GuestOfferQueryInput, user: AuthUser) {
  const pagination = transformPagination(query);
  const where: Prisma.GuestDiscountLogWhereInput = { isDeleted: false };
  if (isManager(user)) where.branchId = user.branchId ?? undefined;
  else if (query.branchId) where.branchId = Number(query.branchId);
  if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
  if (query.search) where.guestName = { contains: query.search };
  if (query.logDate || query.startDate || query.endDate) where.logDate = buildDateFilter(query);

  const [data, total] = await prisma.$transaction([
    prisma.guestDiscountLog.findMany({
      where,
      ...pagination,
      include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
    }),
    prisma.guestDiscountLog.count({ where }),
  ]);

  return { data: data.map(formatLog), meta: buildMetadata(total, pagination) };
}

export async function getDiscountLogById(id: number, user: AuthUser) {
  const log = await prisma.guestDiscountLog.findUnique({
    where: { id },
    include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
  });
  if (!log || log.isDeleted) throw appError("Discount log not found", httpStatus.NOT_FOUND);
  if (isManager(user) && log.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this log", httpStatus.FORBIDDEN);
  }
  return formatLog(log);
}

export async function updateDiscountLog(id: number, payload: GuestDiscountUpdateInput, user: AuthUser) {
  const existing = await prisma.guestDiscountLog.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw appError("Discount log not found", httpStatus.NOT_FOUND);
  if (isManager(user)) {
    if (existing.branchId !== user.branchId) throw appError("Forbidden: own branch only", httpStatus.FORBIDDEN);
    if (existing.approvalStatus !== "PENDING") throw appError("Approved or rejected logs cannot be edited", httpStatus.CONFLICT);
  }

  const data: Prisma.GuestDiscountLogUpdateInput = {};
  const totalBill = payload.totalBill ?? Number(existing.totalBill);
  const discountPercent = payload.discountPercent ?? Number(existing.discountPercent);
  const discountAmount = roundMoney((totalBill * discountPercent) / 100);

  if (payload.logDate !== undefined) data.logDate = toDateOnly(payload.logDate);
  if (payload.guestName !== undefined) data.guestName = payload.guestName;
  if (payload.mobile !== undefined) data.mobile = payload.mobile;
  if (payload.hadLunch !== undefined) data.hadLunch = payload.hadLunch;
  if (payload.hadDinner !== undefined) data.hadDinner = payload.hadDinner;
  if (payload.totalBill !== undefined) data.totalBill = payload.totalBill;
  if (payload.discountPercent !== undefined) data.discountPercent = payload.discountPercent;
  data.discountAmount = discountAmount;
  if (payload.reasonForDiscount !== undefined) data.reasonForDiscount = payload.reasonForDiscount;

  const log = await prisma.guestDiscountLog.update({
    where: { id },
    data,
    include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
  });
  return formatLog(log);
}

export async function setDiscountLogApproval(id: number, payload: ApprovalStatusInput, user: AuthUser) {
  const existing = await prisma.guestDiscountLog.findUnique({ where: { id }, select: { approvalStatus: true, isDeleted: true } });
  if (!existing || existing.isDeleted) throw appError("Discount log not found", httpStatus.NOT_FOUND);
  if (existing.approvalStatus === "APPROVED") throw appError("This log is already approved", httpStatus.CONFLICT);

  const log = await prisma.guestDiscountLog.update({
    where: { id },
    data: {
      approvalStatus: payload.approvalStatus,
      verifiedByUserId: user.id,
      approvedByUserId: user.id,
      approvedAt: new Date(),
    },
    include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
  });
  return formatLog(log);
}

export async function deleteDiscountLog(id: number, user: AuthUser) {
  const existing = await prisma.guestDiscountLog.findUnique({ where: { id }, select: { branchId: true, isDeleted: true } });
  if (!existing || existing.isDeleted) throw appError("Discount log not found", httpStatus.NOT_FOUND);
  if (isManager(user) && existing.branchId !== user.branchId) throw appError("Forbidden: own branch only", httpStatus.FORBIDDEN);
  return prisma.guestDiscountLog.update({ where: { id }, data: { isDeleted: true } });
}

// ─── Entertainment logs ───────────────────────────────────────────────────────

export async function createEntertainmentLog(payload: GuestEntertainmentCreateInput, user: AuthUser) {
  const branchId = resolveBranchScope(payload.branchId, user);

  const log = await prisma.guestEntertainmentLog.create({
    data: {
      branchId,
      logDate: toDateOnly(payload.logDate),
      guestName: payload.guestName,
      mobile: payload.mobile,
      hadLunch: payload.hadLunch ?? false,
      hadDinner: payload.hadDinner ?? false,
      foodName: payload.foodName,
      foodCost: payload.foodCost,
      reasonForEntertainment: payload.reasonForEntertainment,
      offeredByUserId: user.id,
    },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      offeredBy: { select: { id: true, name: true } },
    },
  });

  return formatLog(log);
}

export async function getPaginatedEntertainmentLogs(query: GuestOfferQueryInput, user: AuthUser) {
  const pagination = transformPagination(query);
  const where: Prisma.GuestEntertainmentLogWhereInput = { isDeleted: false };
  if (isManager(user)) where.branchId = user.branchId ?? undefined;
  else if (query.branchId) where.branchId = Number(query.branchId);
  if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
  if (query.search) where.guestName = { contains: query.search };
  if (query.logDate || query.startDate || query.endDate) where.logDate = buildDateFilter(query);

  const [data, total] = await prisma.$transaction([
    prisma.guestEntertainmentLog.findMany({
      where,
      ...pagination,
      include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
    }),
    prisma.guestEntertainmentLog.count({ where }),
  ]);

  return { data: data.map(formatLog), meta: buildMetadata(total, pagination) };
}

export async function getEntertainmentLogById(id: number, user: AuthUser) {
  const log = await prisma.guestEntertainmentLog.findUnique({
    where: { id },
    include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
  });
  if (!log || log.isDeleted) throw appError("Entertainment log not found", httpStatus.NOT_FOUND);
  if (isManager(user) && log.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this log", httpStatus.FORBIDDEN);
  }
  return formatLog(log);
}

export async function updateEntertainmentLog(id: number, payload: GuestEntertainmentUpdateInput, user: AuthUser) {
  const existing = await prisma.guestEntertainmentLog.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw appError("Entertainment log not found", httpStatus.NOT_FOUND);
  if (isManager(user)) {
    if (existing.branchId !== user.branchId) throw appError("Forbidden: own branch only", httpStatus.FORBIDDEN);
    if (existing.approvalStatus !== "PENDING") throw appError("Approved or rejected logs cannot be edited", httpStatus.CONFLICT);
  }

  const data: Prisma.GuestEntertainmentLogUpdateInput = {};
  if (payload.logDate !== undefined) data.logDate = toDateOnly(payload.logDate);
  if (payload.guestName !== undefined) data.guestName = payload.guestName;
  if (payload.mobile !== undefined) data.mobile = payload.mobile;
  if (payload.hadLunch !== undefined) data.hadLunch = payload.hadLunch;
  if (payload.hadDinner !== undefined) data.hadDinner = payload.hadDinner;
  if (payload.foodName !== undefined) data.foodName = payload.foodName;
  if (payload.foodCost !== undefined) data.foodCost = payload.foodCost;
  if (payload.reasonForEntertainment !== undefined) data.reasonForEntertainment = payload.reasonForEntertainment;

  const log = await prisma.guestEntertainmentLog.update({
    where: { id },
    data,
    include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
  });
  return formatLog(log);
}

export async function setEntertainmentLogApproval(id: number, payload: ApprovalStatusInput, user: AuthUser) {
  const existing = await prisma.guestEntertainmentLog.findUnique({ where: { id }, select: { approvalStatus: true, isDeleted: true } });
  if (!existing || existing.isDeleted) throw appError("Entertainment log not found", httpStatus.NOT_FOUND);
  if (existing.approvalStatus === "APPROVED") throw appError("This log is already approved", httpStatus.CONFLICT);

  const log = await prisma.guestEntertainmentLog.update({
    where: { id },
    data: {
      approvalStatus: payload.approvalStatus,
      verifiedByUserId: user.id,
      approvedByUserId: user.id,
      approvedAt: new Date(),
    },
    include: { branch: { select: { id: true, name: true, code: true } }, offeredBy: { select: { id: true, name: true } } },
  });
  return formatLog(log);
}

export async function deleteEntertainmentLog(id: number, user: AuthUser) {
  const existing = await prisma.guestEntertainmentLog.findUnique({ where: { id }, select: { branchId: true, isDeleted: true } });
  if (!existing || existing.isDeleted) throw appError("Entertainment log not found", httpStatus.NOT_FOUND);
  if (isManager(user) && existing.branchId !== user.branchId) throw appError("Forbidden: own branch only", httpStatus.FORBIDDEN);
  return prisma.guestEntertainmentLog.update({ where: { id }, data: { isDeleted: true } });
}

// ─── Daily summary ────────────────────────────────────────────────────────────

export async function getDailySummary(query: GuestOfferQueryInput, user: AuthUser) {
  const discountWhere: Prisma.GuestDiscountLogWhereInput = { isDeleted: false };
  const entertainmentWhere: Prisma.GuestEntertainmentLogWhereInput = { isDeleted: false };

  if (isManager(user)) {
    discountWhere.branchId = user.branchId ?? undefined;
    entertainmentWhere.branchId = user.branchId ?? undefined;
  } else if (query.branchId) {
    discountWhere.branchId = Number(query.branchId);
    entertainmentWhere.branchId = Number(query.branchId);
  }
  if (query.logDate || query.startDate || query.endDate) {
    const start = query.logDate ? toDateOnly(query.logDate) : query.startDate ? toDateOnly(query.startDate) : undefined;
    const end = query.logDate ? toEndOfDay(query.logDate) : query.endDate ? toEndOfDay(query.endDate) : undefined;
    discountWhere.logDate = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
    entertainmentWhere.logDate = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  }

  const [discountAgg, entertainmentAgg] = await Promise.all([
    prisma.guestDiscountLog.aggregate({
      where: discountWhere,
      _sum: { discountAmount: true, totalBill: true },
      _count: true,
    }),
    prisma.guestEntertainmentLog.aggregate({
      where: entertainmentWhere,
      _sum: { foodCost: true },
      _count: true,
    }),
  ]);

  return {
    discount: {
      totalBill: Number(discountAgg._sum.totalBill) || 0,
      totalDiscountAmount: Number(discountAgg._sum.discountAmount) || 0,
      logs: discountAgg._count,
    },
    entertainment: {
      totalCost: Number(entertainmentAgg._sum.foodCost) || 0,
      logs: entertainmentAgg._count,
    },
  };
}
