import httpStatus from "http-status";
import { Prisma, Role } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { CreateFeedbackInput, FeedbackQueryInput } from "./feedback.validation";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { publishDataChanged } from "../../lib/realtime";
import { invalidateAnalyticsCaches } from "../analytics/analytics.service";

interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
}

export async function submitFeedback(payload: CreateFeedbackInput) {
  const branch = await prisma.branch.findFirst({
    where: { id: payload.branchId, isActive: true, isDeleted: false },
    select: { id: true },
  });
  if (!branch) throw appError("Branch not found or inactive", httpStatus.NOT_FOUND);

  try {
    const feedback = await prisma.guestFeedback.create({
      data: {
        ...payload,
        contact: payload.contact ?? "",
      },
    });
    // New feedback changes KPI/chart/insight data for the branch + all admins.
    if (feedback.branchId) {
      publishDataChanged("feedback.created", { type: "branch", branchId: Number(feedback.branchId) });
    } else {
      publishDataChanged("feedback.created", { type: "global" });
    }
    // Drop stale derived analytics so the next dashboard read is fresh.
    await invalidateAnalyticsCaches(feedback.branchId ? Number(feedback.branchId) : null);
    return feedback;
  } catch (error: any) {
    // Idempotent retry: the same feedbackId was already accepted (frontend
    // resends on timeouts/network hiccups) — return the original record.
    if (error.code === "P2002" && payload.feedbackId) {
      const existing = await prisma.guestFeedback.findFirst({
        where: { feedbackId: payload.feedbackId },
      });
      if (existing) return existing;
      throw appError("Duplicate feedback submission", httpStatus.CONFLICT);
    }
    if (error.code === "P2003") {
      throw appError("Branch not found or inactive", httpStatus.NOT_FOUND);
    }
    throw error;
  }
}

export async function getFeedbackById(id: number, user: AuthUser) {
  const feedback = await prisma.guestFeedback.findUnique({
    where: { id },
    include: { branch: { select: { name: true, code: true } } },
  });
  if (!feedback) throw appError("Feedback not found", httpStatus.NOT_FOUND);
  if (user.role === Role.BRANCH_MANAGER && feedback.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this feedback", httpStatus.FORBIDDEN);
  }
  return feedback;
}

export async function getPaginatedFeedbacks(query: FeedbackQueryInput, branchId?: number) {
  const pagination = transformPagination(query);
  const where: Prisma.GuestFeedbackWhereInput = {};

  // branchId from auth context (BRANCH_MANAGER) takes precedence over query param.
  if (branchId) {
    where.branchId = branchId;
  } else if (query.branchId) {
    where.branchId = Number(query.branchId);
  }

  if (query.rating) where.overallRating = Number(query.rating);

  if (query.search) {
    where.OR = [
      { guestName: { contains: query.search } },
      { contact: { contains: query.search } },
    ];
  }

  if (query.startDate || query.endDate) {
    const dateFilter: Prisma.DateTimeFilter<"GuestFeedback"> = {};
    if (query.startDate) dateFilter.gte = new Date(query.startDate);
    if (query.endDate) {
      // Inclusive end-of-day so feedback submitted on the end date is included.
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.submittedAt = dateFilter;
  }

  // Run the page rows, total count, and the (tiny) branch lookup in parallel. An
  // `include` would add a second serialized round-trip per query on high-latency
  // links, so branch display data is fetched once and mapped in JS.
  const [rows, total, branches] = await Promise.all([
    prisma.guestFeedback.findMany({ where, ...pagination }),
    prisma.guestFeedback.count({ where }),
    prisma.branch.findMany({ where: { isDeleted: false }, select: { id: true, name: true, code: true } }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, { name: b.name, code: b.code }]));
  const data = rows.map((f) => ({ ...f, branch: branchMap.get(f.branchId) ?? null }));

  return { data, meta: buildMetadata(total, pagination) };
}
