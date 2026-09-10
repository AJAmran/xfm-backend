import ExcelJS from "exceljs";
import httpStatus from "http-status";
import { randomBytes } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import {
  formatDateOnly,
  toDateOnly,
  toEndOfDay,
  getDhakaTodayString,
  toMonthStart,
  toNextMonthStart,
} from "../../utils/dateHelpers";
import { resolveBranchScope } from "../../utils/accessScope";
import { publishDataChanged } from "../../lib/realtime";
import { withCache, invalidateByPrefix } from "../../lib/cache";
import env from "../../config/env";
import {
  CreateBookingInput,
  UpdateBookingInput,
  BookingQueryInput,
  BookingReportQueryInput,
  PaxAdjustInput,
  ActualPaxInput,
  BookingStatusInput,
} from "./booking.validation";
import {
  computePaxSummary,
  isValidStatusTransition,
  buildWarningsForBookings,
  BookingWarning,
} from "./booking.logic";

interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
}

function isManager(user: AuthUser): boolean {
  return user.role === "BRANCH_MANAGER";
}

/**
 * Returns the branch a BRANCH_MANAGER is scoped to, or throws.
 * Guards every read path so a manager without an assigned branch can never
 * fall through to an unscoped (all-branches) query.
 */
function requireManagerBranch(user: AuthUser): number {
  if (!user.branchId) throw appError("No branch is assigned to your account", httpStatus.FORBIDDEN);
  return user.branchId;
}

const BOOKING_INCLUDE = {
  branch: { select: { id: true, name: true, code: true, capacity: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

const BOOKING_DETAIL_INCLUDE = {
  branch: { select: { id: true, name: true, code: true, capacity: true } },
  createdBy: { select: { id: true, name: true } },
  confirmedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  adjustments: {
    orderBy: { createdAt: "asc" as const },
    include: { createdBy: { select: { id: true, name: true } } },
  },
  statusHistory: {
    orderBy: { createdAt: "asc" as const },
    include: { changedBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.BookingInclude;

const BOOKINGS_PREFIX = "bookings_";
const BOOKINGS_TTL = 20;

function bookingsKey(kind: string, query: unknown, user: AuthUser): string {
  const scope = isManager(user) ? `bm_${user.branchId ?? "none"}` : "all";
  return `${BOOKINGS_PREFIX}${kind}_${scope}:${JSON.stringify(query)}`;
}

async function invalidateBookingCaches(): Promise<void> {
  await invalidateByPrefix(BOOKINGS_PREFIX);
}

type BookingRow = {
  partyDate: Date;
  [key: string]: unknown;
};

function formatBooking<T extends BookingRow>(booking: T): T {
  return { ...booking, partyDate: formatDateOnly(booking.partyDate) } as T;
}

function generateBookingNumber(partyDate: string): string {
  const compact = partyDate.replaceAll("-", "");
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `BK-${compact}-${rand}`;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createBooking(payload: CreateBookingInput, user: AuthUser) {
  const branchId = resolveBranchScope(payload.branchId, user);

  const branch = await prisma.branch.findUnique({ where: { id: branchId, isDeleted: false } });
  if (!branch || !branch.isActive) throw appError("Branch not found", httpStatus.NOT_FOUND);

  const partyDate = toDateOnly(payload.partyDate);

  // No backdated parties — a booking starts today or later (Dhaka time).
  if (payload.partyDate < getDhakaTodayString()) {
    throw appError("Bookings cannot be created for past dates", httpStatus.BAD_REQUEST);
  }

  // Retry on booking-number collision (P2002) — random suffix makes this rare.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const directConfirm = payload.status === "CONFIRMED";
      const booking = await prisma.booking.create({
        data: {
          bookingNumber: generateBookingNumber(payload.partyDate),
          branchId,
          guestName: payload.guestName,
          guestMobile: payload.guestMobile,
          partyDate,
          partyType: payload.partyType,
          initialPax: payload.initialPax,
          expectedPax: payload.initialPax,
          remarks: payload.remarks ?? null,
          createdByUserId: user.id,
          status: directConfirm ? "CONFIRMED" : "TENTATIVE",
          confirmedByUserId: directConfirm ? user.id : null,
          confirmedAt: directConfirm ? new Date() : null,
          statusHistory: {
            create: directConfirm
              ? [
                  { fromStatus: null, toStatus: "TENTATIVE", changedByUserId: user.id },
                  { fromStatus: "TENTATIVE", toStatus: "CONFIRMED", changedByUserId: user.id },
                ]
              : { fromStatus: null, toStatus: "TENTATIVE", changedByUserId: user.id },
          },
        },
        include: BOOKING_INCLUDE,
      });
      publishDataChanged("booking.created", { type: "branch", branchId });
      await invalidateBookingCaches();
      return formatBooking(booking);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : appError("Failed to create booking", httpStatus.INTERNAL_SERVER_ERROR);
}

export async function getPaginatedBookings(query: BookingQueryInput, user: AuthUser) {
  return withCache(bookingsKey("list", query, user), async () => {
    const pagination = transformPagination(query);
    const where: Prisma.BookingWhereInput = { isDeleted: false };

    if (isManager(user)) where.branchId = requireManagerBranch(user);
    else if (query.branchId) where.branchId = Number(query.branchId);
    if (query.partyType) where.partyType = query.partyType;
    if (query.status) where.status = query.status;
    // Overdue closure: past CONFIRMED bookings still missing actual pax.
    if (query.missingActual === "true") where.actualPax = null;
    else if (query.missingActual === "false") where.actualPax = { not: null };
    if (query.search) {
      where.OR = [
        { guestName: { contains: query.search } },
        { guestMobile: { contains: query.search } },
        { bookingNumber: { contains: query.search } },
      ];
    }
    if (query.partyDate) {
      where.partyDate = { gte: toDateOnly(query.partyDate), lte: toEndOfDay(query.partyDate) };
    } else if (query.startDate || query.endDate) {
      const range: { gte?: Date; lte?: Date } = {};
      if (query.startDate) range.gte = toDateOnly(query.startDate);
      if (query.endDate) range.lte = toEndOfDay(query.endDate);
      where.partyDate = range;
    }

    const [data, total] = await prisma.$transaction([
      prisma.booking.findMany({ where, ...pagination, include: BOOKING_INCLUDE }),
      prisma.booking.count({ where }),
    ]);

    return { data: data.map(formatBooking), meta: buildMetadata(total, pagination) };
  }, BOOKINGS_TTL);
}

export async function getBookingById(id: number, user: AuthUser) {
  const booking = await prisma.booking.findUnique({ where: { id }, include: BOOKING_DETAIL_INCLUDE });
  if (!booking || booking.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
  if (isManager(user) && booking.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this booking", httpStatus.FORBIDDEN);
  }
  const summary = computePaxSummary(
    booking.initialPax,
    booking.adjustments.map((a) => ({ type: a.type, quantity: a.quantity })),
    booking.actualPax,
  );
  return { ...formatBooking(booking), paxSummary: summary };
}

export async function updateBooking(id: number, payload: UpdateBookingInput, user: AuthUser) {
  const existing = await prisma.booking.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
  if (isManager(user) && existing.branchId !== user.branchId) {
    throw appError("Forbidden: You can only edit bookings for your own branch", httpStatus.FORBIDDEN);
  }
  if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
    throw appError(`Bookings with status ${existing.status} cannot be edited`, httpStatus.CONFLICT);
  }

  const data: Prisma.BookingUpdateInput = { updatedByUserId: user.id };
  if (payload.guestName !== undefined) data.guestName = payload.guestName;
  if (payload.guestMobile !== undefined) data.guestMobile = payload.guestMobile;
  if (payload.partyDate !== undefined) {
    if (payload.partyDate < getDhakaTodayString()) {
      throw appError("Bookings cannot be moved to past dates", httpStatus.BAD_REQUEST);
    }
    data.partyDate = toDateOnly(payload.partyDate);
  }
  if (payload.partyType !== undefined) data.partyType = payload.partyType;
  if (payload.remarks !== undefined) data.remarks = payload.remarks;

  const booking = await prisma.booking.update({ where: { id }, data, include: BOOKING_INCLUDE });
  publishDataChanged("booking.updated", { type: "branch", branchId: existing.branchId });
  await invalidateBookingCaches();
  return formatBooking(booking);
}

/** Soft delete. Cancelled bookings are protected and cannot be deleted. */
export async function deleteBooking(id: number, user: AuthUser) {
  const existing = await prisma.booking.findUnique({ where: { id }, select: { branchId: true, isDeleted: true, status: true } });
  if (!existing || existing.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
  if (isManager(user) && existing.branchId !== user.branchId) {
    throw appError("Forbidden: You can only delete bookings for your own branch", httpStatus.FORBIDDEN);
  }
  if (existing.status === "CANCELLED") throw appError("Cancelled bookings cannot be deleted", httpStatus.CONFLICT);
  if (existing.status === "COMPLETED") throw appError("Completed bookings cannot be deleted", httpStatus.CONFLICT);

  await prisma.booking.update({ where: { id }, data: { isDeleted: true, updatedByUserId: user.id } });
  publishDataChanged("booking.deleted", { type: "branch", branchId: existing.branchId });
  await invalidateBookingCaches();
  return {};
}

// ─── Pax adjustments (append-only, optimistic locking) ───────────────────────

export async function addPaxAdjustment(id: number, payload: PaxAdjustInput, user: AuthUser) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await prisma.booking.findUnique({
      where: { id },
      select: { branchId: true, isDeleted: true, status: true, expectedPax: true, initialPax: true },
    });
    if (!existing || existing.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
    if (isManager(user) && existing.branchId !== user.branchId) {
      throw appError("Forbidden: own branch only", httpStatus.FORBIDDEN);
    }
    if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
      throw appError(`Pax cannot be adjusted when booking is ${existing.status}`, httpStatus.CONFLICT);
    }

    const delta = payload.type === "INCREASE" ? payload.quantity : -payload.quantity;
    const newExpected = existing.expectedPax + delta;
    if (newExpected < 0) throw appError("Expected pax cannot go below zero", httpStatus.BAD_REQUEST);

    // Optimistic lock: only apply if expectedPax hasn't moved under us.
    const updated = await prisma.booking.updateMany({
      where: { id, expectedPax: existing.expectedPax },
      data: { expectedPax: newExpected, updatedByUserId: user.id },
    });
    if (updated.count === 0) continue; // concurrent writer won — retry

    const adjustment = await prisma.bookingPaxAdjustment.create({
      data: {
        bookingId: id,
        type: payload.type,
        quantity: payload.quantity,
        previousExpectedPax: existing.expectedPax,
        newExpectedPax: newExpected,
        reason: payload.reason ?? null,
        createdByUserId: user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    publishDataChanged("booking.pax-adjusted", { type: "branch", branchId: existing.branchId });
    await invalidateBookingCaches();
    return adjustment;
  }
  throw appError("Booking was updated concurrently, please retry", httpStatus.CONFLICT);
}

export async function getPaxHistory(id: number, user: AuthUser) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { branchId: true, isDeleted: true, initialPax: true, expectedPax: true, actualPax: true },
  });
  if (!booking || booking.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
  if (isManager(user) && booking.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this booking", httpStatus.FORBIDDEN);
  }
  const adjustments = await prisma.bookingPaxAdjustment.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "asc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  const summary = computePaxSummary(
    booking.initialPax,
    adjustments.map((a) => ({ type: a.type, quantity: a.quantity })),
    booking.actualPax,
  );
  return { summary, adjustments };
}

// ─── Actual pax + status ─────────────────────────────────────────────────────

export async function setActualPax(id: number, payload: ActualPaxInput, user: AuthUser) {
  const existing = await prisma.booking.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
  if (isManager(user) && existing.branchId !== user.branchId) {
    throw appError("Forbidden: own branch only", httpStatus.FORBIDDEN);
  }
  if (existing.status === "CANCELLED") throw appError("Cancelled bookings cannot have actual pax", httpStatus.CONFLICT);
  if (existing.status === "TENTATIVE") throw appError("Confirm the booking before entering actual pax", httpStatus.CONFLICT);

  const booking = await prisma.booking.update({
    where: { id },
    data: { actualPax: payload.actualPax, updatedByUserId: user.id },
    include: BOOKING_INCLUDE,
  });
  publishDataChanged("booking.actual-pax", { type: "branch", branchId: existing.branchId });
  await invalidateBookingCaches();
  return formatBooking(booking);
}

export async function setBookingStatus(id: number, payload: BookingStatusInput, user: AuthUser) {
  const existing = await prisma.booking.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
  if (isManager(user) && existing.branchId !== user.branchId) {
    throw appError("Forbidden: own branch only", httpStatus.FORBIDDEN);
  }
  if (!isValidStatusTransition(existing.status, payload.status)) {
    throw appError(`Cannot change status from ${existing.status} to ${payload.status}`, httpStatus.CONFLICT);
  }
  if (payload.status === "CANCELLED" && !payload.reason?.trim()) {
    throw appError("Cancellation reason is required", httpStatus.BAD_REQUEST);
  }
  if (payload.status === "COMPLETED" && existing.actualPax == null) {
    throw appError("Enter actual pax before completing the booking", httpStatus.BAD_REQUEST);
  }
  // A party can only be completed once its day has arrived (Dhaka time) —
  // no early completions. Past-due bookings stay completable (grace).
  if (payload.status === "COMPLETED" && formatDateOnly(existing.partyDate) > getDhakaTodayString()) {
    throw appError("Bookings can only be completed on or after the party date", httpStatus.BAD_REQUEST);
  }

  const data: Prisma.BookingUncheckedUpdateInput = { status: payload.status, updatedByUserId: user.id };
  if (payload.status === "CONFIRMED") {
    data.confirmedByUserId = user.id;
    data.confirmedAt = new Date();
  } else if (payload.status === "CANCELLED") {
    data.cancelledByUserId = user.id;
    data.cancelledAt = new Date();
    data.cancellationReason = payload.reason!.trim();
  } else if (payload.status === "COMPLETED") {
    data.completedByUserId = user.id;
    data.completedAt = new Date();
  }

  const booking = await prisma.$transaction((tx) =>
    tx.booking.update({
      where: { id },
      data: {
        ...data,
        statusHistory: {
          create: { fromStatus: existing.status, toStatus: payload.status, reason: payload.reason ?? null, changedByUserId: user.id },
        },
      },
      include: BOOKING_DETAIL_INCLUDE,
    }),
  );

  publishDataChanged("booking.status", { type: "branch", branchId: existing.branchId });
  await invalidateBookingCaches();
  const summary = computePaxSummary(
    booking.initialPax,
    booking.adjustments.map((a) => ({ type: a.type, quantity: a.quantity })),
    booking.actualPax,
  );
  return { ...formatBooking(booking), paxSummary: summary };
}

export async function getStatusHistory(id: number, user: AuthUser) {
  const booking = await prisma.booking.findUnique({ where: { id }, select: { branchId: true, isDeleted: true } });
  if (!booking || booking.isDeleted) throw appError("Booking not found", httpStatus.NOT_FOUND);
  if (isManager(user) && booking.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this booking", httpStatus.FORBIDDEN);
  }
  return prisma.bookingStatusHistory.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "asc" },
    include: { changedBy: { select: { id: true, name: true } } },
  });
}

// ─── Dashboard / calendar / upcoming ─────────────────────────────────────────

export interface BookingDashboardFilters {
  branchId?: string;
}

export async function getDashboard(user: AuthUser, filters: BookingDashboardFilters = {}) {
  return withCache(bookingsKey("dashboard", filters, user), async () => {
    const today = getDhakaTodayString();
    const branchId = isManager(user) ? requireManagerBranch(user) : filters.branchId ? Number(filters.branchId) : undefined;

    const base: Prisma.BookingWhereInput = { isDeleted: false };
    if (branchId) base.branchId = branchId;

    const dayRange = { gte: toDateOnly(today), lte: toEndOfDay(today) };

    const [todayBookings, counts, pax] = await Promise.all([
      prisma.booking.findMany({
        where: { ...base, partyDate: dayRange },
        include: BOOKING_INCLUDE,
        orderBy: { partyType: "asc" },
        take: 200,
      }),
      prisma.booking.groupBy({ by: ["status"], where: { ...base, partyDate: dayRange }, _count: { _all: true } }),
      prisma.booking.aggregate({
        where: { ...base, partyDate: dayRange },
        _sum: { initialPax: true, expectedPax: true, actualPax: true },
      }),
    ]);

    const byStatus: Record<string, number> = { TENTATIVE: 0, CONFIRMED: 0, CANCELLED: 0, COMPLETED: 0 };
    for (const c of counts) byStatus[c.status] = c._count._all ?? 0;

    return {
      date: today,
      today: {
        total: todayBookings.length,
        tentative: byStatus.TENTATIVE,
        confirmed: byStatus.CONFIRMED,
        cancelled: byStatus.CANCELLED,
        completed: byStatus.COMPLETED,
        lunch: todayBookings.filter((b) => b.partyType === "LUNCH").length,
        dinner: todayBookings.filter((b) => b.partyType === "DINNER").length,
        initialPax: pax._sum.initialPax ?? 0,
        expectedPax: pax._sum.expectedPax ?? 0,
        actualPax: pax._sum.actualPax ?? 0,
      },
      bookings: todayBookings.map(formatBooking),
    };
  }, BOOKINGS_TTL);
}

export async function getUpcoming(user: AuthUser, limit = 20, branchId?: number) {
  const effectiveBranch = isManager(user) ? requireManagerBranch(user) : branchId;
  const where: Prisma.BookingWhereInput = {
    isDeleted: false,
    status: { in: ["TENTATIVE", "CONFIRMED"] },
    partyDate: { gte: toDateOnly(getDhakaTodayString()) },
  };
  if (effectiveBranch) where.branchId = effectiveBranch;
  const bookings = await prisma.booking.findMany({
    where,
    include: BOOKING_INCLUDE,
    orderBy: { partyDate: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return bookings.map(formatBooking);
}

export interface BookingCalendarParams {
  startDate?: string;
  endDate?: string;
  branchId?: string;
  partyType?: "LUNCH" | "DINNER";
  status?: "TENTATIVE" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
}

export async function getCalendar(user: AuthUser, params: BookingCalendarParams) {
  const today = getDhakaTodayString();
  const start = params.startDate ?? today;
  const end = params.endDate ?? today;
  const where: Prisma.BookingWhereInput = {
    isDeleted: false,
    partyDate: { gte: toDateOnly(start), lte: toEndOfDay(end) },
  };
  if (isManager(user)) where.branchId = requireManagerBranch(user);
  else if (params.branchId) where.branchId = Number(params.branchId);
  if (params.partyType) where.partyType = params.partyType;
  if (params.status) where.status = params.status;

  const bookings = await prisma.booking.findMany({
    where,
    include: BOOKING_INCLUDE,
    orderBy: [{ partyDate: "asc" }, { partyType: "asc" }],
    take: env.report_fetch_limit,
  });
  return { startDate: start, endDate: end, bookings: bookings.map(formatBooking) };
}

// ─── Warnings ────────────────────────────────────────────────────────────────

export async function getWarnings(user: AuthUser, branchId?: number): Promise<{ date: string; warnings: BookingWarning[] }> {
  return withCache(bookingsKey("warnings", { branchId }, user), async () => {
    const today = getDhakaTodayString();
    const todayDate = toDateOnly(today);
    const past = new Date(todayDate.getTime() - 7 * 86400000);
    const future = new Date(todayDate.getTime() + 8 * 86400000);

    const where: Prisma.BookingWhereInput = {
      isDeleted: false,
      partyDate: { gte: past, lt: future },
    };
    if (isManager(user)) where.branchId = requireManagerBranch(user);
    else if (branchId) where.branchId = branchId;

    const bookings = await prisma.booking.findMany({
      where,
      select: {
        id: true,
        bookingNumber: true,
        branchId: true,
        guestName: true,
        partyDate: true,
        partyType: true,
        status: true,
        initialPax: true,
        expectedPax: true,
        actualPax: true,
        branch: { select: { code: true, name: true, capacity: true } },
      },
      orderBy: { partyDate: "asc" },
      take: env.report_fetch_limit,
    });

    const warnings = buildWarningsForBookings(
      bookings.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        branchId: b.branchId,
        branchCode: b.branch.code,
        branchName: b.branch.name,
        guestName: b.guestName,
        partyDate: formatDateOnly(b.partyDate),
        partyType: b.partyType,
        status: b.status,
        initialPax: b.initialPax,
        expectedPax: b.expectedPax,
        actualPax: b.actualPax,
        branchCapacity: b.branch.capacity,
        today,
      })),
    );
    return { date: today, warnings };
  }, BOOKINGS_TTL);
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface BookingReportResult {
  range: { startDate: string; endDate: string };
  summary: {
    total: number;
    tentative: number;
    confirmed: number;
    cancelled: number;
    completed: number;
    lunch: number;
    dinner: number;
    lunchPax: number;
    dinnerPax: number;
    lunchActualPax: number;
    dinnerActualPax: number;
    initialPax: number;
    expectedPax: number;
    actualPax: number;
  };
  branchBreakdown: Array<{
    branchId: number;
    branchCode: string;
    branchName: string;
    total: number;
    confirmed: number;
    lunch: number;
    dinner: number;
    lunchPax: number;
    dinnerPax: number;
    lunchActualPax: number;
    dinnerActualPax: number;
    initialPax: number;
    expectedPax: number;
    actualPax: number;
  }>;
}

async function aggregateReport(where: Prisma.BookingWhereInput, startDate: string, endDate: string): Promise<BookingReportResult> {
  const [statusGroups, typeGroups, branchGroups, typeByBranchGroups, pax] = await Promise.all([
    prisma.booking.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.booking.groupBy({
      by: ["partyType"],
      where,
      _count: { _all: true },
      _sum: { expectedPax: true, actualPax: true },
    }),
    prisma.booking.groupBy({
      by: ["branchId"],
      where,
      _count: { _all: true },
      _sum: { initialPax: true, expectedPax: true, actualPax: true },
    }),
    // Lunch/Dinner split per branch: party counts + expected + actual pax
    // (single grouped query, bounded by branches × 2)
    prisma.booking.groupBy({
      by: ["branchId", "partyType"],
      where,
      _count: { _all: true },
      _sum: { expectedPax: true, actualPax: true },
    }),
    prisma.booking.aggregate({ where, _sum: { initialPax: true, expectedPax: true, actualPax: true } }),
  ]);

  const byStatus: Record<string, number> = { TENTATIVE: 0, CONFIRMED: 0, CANCELLED: 0, COMPLETED: 0 };
  for (const g of statusGroups) byStatus[g.status] = g._count._all ?? 0;
  const byType: Record<string, number> = { LUNCH: 0, DINNER: 0 };
  const byTypePax: Record<string, number> = { LUNCH: 0, DINNER: 0 };
  const byTypeActualPax: Record<string, number> = { LUNCH: 0, DINNER: 0 };
  for (const g of typeGroups) {
    byType[g.partyType] = g._count._all ?? 0;
    byTypePax[g.partyType] = g._sum.expectedPax ?? 0;
    byTypeActualPax[g.partyType] = g._sum.actualPax ?? 0;
  }

  const branchIds = branchGroups.map((g) => g.branchId);
  const branches = branchIds.length
    ? await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, code: true, name: true } })
    : [];
  const branchMap = new Map(branches.map((b) => [b.id, b]));

  // Per-branch confirmed + lunch/dinner counts (grouped queries, bounded by branch count)
  const confirmedGroups = await prisma.booking.groupBy({
    by: ["branchId"],
    where: { ...where, status: "CONFIRMED" },
    _count: { _all: true },
  });
  const confirmedMap = new Map(confirmedGroups.map((g) => [g.branchId, g._count._all]));
  const lunchMap = new Map<number, number>();
  const dinnerMap = new Map<number, number>();
  const lunchPaxMap = new Map<number, number>();
  const dinnerPaxMap = new Map<number, number>();
  const lunchActualPaxMap = new Map<number, number>();
  const dinnerActualPaxMap = new Map<number, number>();
  for (const g of typeByBranchGroups) {
    const isLunch = g.partyType === "LUNCH";
    const countTarget = isLunch ? lunchMap : dinnerMap;
    const paxTarget = isLunch ? lunchPaxMap : dinnerPaxMap;
    const actualTarget = isLunch ? lunchActualPaxMap : dinnerActualPaxMap;
    countTarget.set(g.branchId, (countTarget.get(g.branchId) ?? 0) + (g._count._all ?? 0));
    paxTarget.set(g.branchId, (paxTarget.get(g.branchId) ?? 0) + (g._sum.expectedPax ?? 0));
    actualTarget.set(g.branchId, (actualTarget.get(g.branchId) ?? 0) + (g._sum.actualPax ?? 0));
  }

  return {
    range: { startDate, endDate },
    summary: {
      total: statusGroups.reduce((s, g) => s + (g._count._all ?? 0), 0),
      tentative: byStatus.TENTATIVE ?? 0,
      confirmed: byStatus.CONFIRMED ?? 0,
      cancelled: byStatus.CANCELLED ?? 0,
      completed: byStatus.COMPLETED ?? 0,
      lunch: byType.LUNCH ?? 0,
      dinner: byType.DINNER ?? 0,
      lunchPax: byTypePax.LUNCH ?? 0,
      dinnerPax: byTypePax.DINNER ?? 0,
      lunchActualPax: byTypeActualPax.LUNCH ?? 0,
      dinnerActualPax: byTypeActualPax.DINNER ?? 0,
      initialPax: pax._sum.initialPax ?? 0,
      expectedPax: pax._sum.expectedPax ?? 0,
      actualPax: pax._sum.actualPax ?? 0,
    },
    branchBreakdown: branchGroups.map((g) => ({
      branchId: g.branchId,
      branchCode: branchMap.get(g.branchId)?.code ?? `#${g.branchId}`,
      branchName: branchMap.get(g.branchId)?.name ?? `#${g.branchId}`,
      total: g._count._all,
      confirmed: confirmedMap.get(g.branchId) ?? 0,
      lunch: lunchMap.get(g.branchId) ?? 0,
      dinner: dinnerMap.get(g.branchId) ?? 0,
      lunchPax: lunchPaxMap.get(g.branchId) ?? 0,
      dinnerPax: dinnerPaxMap.get(g.branchId) ?? 0,
      lunchActualPax: lunchActualPaxMap.get(g.branchId) ?? 0,
      dinnerActualPax: dinnerActualPaxMap.get(g.branchId) ?? 0,
      initialPax: g._sum.initialPax ?? 0,
      expectedPax: g._sum.expectedPax ?? 0,
      actualPax: g._sum.actualPax ?? 0,
    })),
  };
}

function reportWhere(user: AuthUser, q: BookingReportQueryInput, startDate: string, endDate: string): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = {
    isDeleted: false,
    partyDate: { gte: toDateOnly(startDate), lte: toEndOfDay(endDate) },
  };
  if (isManager(user)) where.branchId = requireManagerBranch(user);
  else if (q.branchId) where.branchId = Number(q.branchId);
  if (q.partyType) where.partyType = q.partyType;
  if (q.status) where.status = q.status;
  return where;
}

export async function getBookingReport(query: BookingReportQueryInput, user: AuthUser): Promise<BookingReportResult> {
  const today = getDhakaTodayString();
  const startDate = query.startDate ?? today;
  const endDate = query.endDate ?? startDate;
  const key = bookingsKey("report", query, user);
  return withCache(key, () => aggregateReport(reportWhere(user, query, startDate, endDate), startDate, endDate), BOOKINGS_TTL);
}

export async function getDailyReport(date: string | undefined, user: AuthUser, branchId?: string): Promise<BookingReportResult> {
  const day = date ?? getDhakaTodayString();
  return getBookingReport({ startDate: day, endDate: day, branchId }, user);
}

export async function getWeeklyReport(date: string | undefined, user: AuthUser, branchId?: string): Promise<BookingReportResult> {
  const anchor = toDateOnly(date ?? getDhakaTodayString());
  // Week starts Monday (UTC)
  const dow = (anchor.getUTCDay() + 6) % 7;
  const monday = new Date(anchor.getTime() - dow * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const startDate = formatDateOnly(monday);
  const endDate = formatDateOnly(sunday);
  return getBookingReport({ startDate, endDate, branchId }, user);
}

export async function getMonthlyReport(month: string | undefined, user: AuthUser, branchId?: string): Promise<BookingReportResult & { month: string }> {
  const m = month ?? getDhakaTodayString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw appError("Expected month as YYYY-MM", httpStatus.BAD_REQUEST);
  const startDate = `${m}-01`;
  const end = toNextMonthStart(m);
  const endDate = formatDateOnly(new Date(end.getTime() - 1));
  const report = await getBookingReport({ startDate, endDate, branchId }, user);
  return { ...report, month: m };
}

export async function exportBookingsExcel(query: BookingReportQueryInput, user: AuthUser) {
  const today = getDhakaTodayString();
  const startDate = query.startDate ?? today;
  const endDate = query.endDate ?? query.startDate ?? today;
  const where = reportWhere(user, query, startDate, endDate);

  const bookings = await prisma.booking.findMany({
    where,
    include: { branch: { select: { name: true, code: true } } },
    orderBy: { partyDate: "asc" },
    take: env.report_export_limit,
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bookings");
  sheet.columns = [
    { header: "Booking No", key: "bookingNumber", width: 20 },
    { header: "Branch", key: "branch", width: 25 },
    { header: "Guest Name", key: "guestName", width: 22 },
    { header: "Mobile", key: "guestMobile", width: 16 },
    { header: "Party Date", key: "partyDate", width: 12 },
    { header: "Party Type", key: "partyType", width: 10 },
    { header: "Initial Pax", key: "initialPax", width: 12 },
    { header: "Expected Pax", key: "expectedPax", width: 13 },
    { header: "Actual Pax", key: "actualPax", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Remarks", key: "remarks", width: 30 },
  ];
  for (const b of bookings) {
    sheet.addRow({
      bookingNumber: b.bookingNumber,
      branch: b.branch.name,
      guestName: b.guestName,
      guestMobile: b.guestMobile,
      partyDate: formatDateOnly(b.partyDate),
      partyType: b.partyType,
      initialPax: b.initialPax,
      expectedPax: b.expectedPax,
      actualPax: b.actualPax ?? "",
      status: b.status,
      remarks: b.remarks ?? "",
    });
  }
  sheet.getRow(1).font = { bold: true };
  return workbook;
}

// ─── Audit timeline ──────────────────────────────────────────────────────────

export async function getBookingTimeline(id: number, user: AuthUser) {
  const detail = await getBookingById(id, user);
  const events: Array<{ at: string; kind: string; title: string; detail?: string; by?: string }> = [
    {
      at: typeof detail.createdAt === "string" ? detail.createdAt : (detail.createdAt as Date).toISOString(),
      kind: "CREATED",
      title: `Booking created — initial pax ${detail.initialPax}`,
      by: (detail.createdBy as { name?: string } | undefined)?.name,
    },
  ];
  for (const a of (detail as { adjustments: Array<{ type: string; quantity: number; previousExpectedPax: number; newExpectedPax: number; reason: string | null; createdAt: Date | string; createdBy?: { name?: string } }> }).adjustments) {
    events.push({
      at: typeof a.createdAt === "string" ? a.createdAt : a.createdAt.toISOString(),
      kind: a.type === "INCREASE" ? "PAX_INCREASED" : "PAX_DECREASED",
      title: `Pax ${a.type === "INCREASE" ? "increased" : "decreased"} by ${a.quantity} (${a.previousExpectedPax} → ${a.newExpectedPax})`,
      detail: a.reason ?? undefined,
      by: a.createdBy?.name,
    });
  }
  if (detail.actualPax != null) {
    events.push({ at: "", kind: "ACTUAL_PAX", title: `Actual pax entered: ${detail.actualPax}` });
  }
  for (const s of (detail as { statusHistory: Array<{ fromStatus: string | null; toStatus: string; reason: string | null; createdAt: Date | string; changedBy?: { name?: string } }> }).statusHistory) {
    if (s.fromStatus === null) continue; // creation already covered
    events.push({
      at: typeof s.createdAt === "string" ? s.createdAt : s.createdAt.toISOString(),
      kind: `STATUS_${s.toStatus}`,
      title: `Status: ${s.fromStatus} → ${s.toStatus}`,
      detail: s.reason ?? undefined,
      by: s.changedBy?.name,
    });
  }
  return { booking: detail, events };
}
