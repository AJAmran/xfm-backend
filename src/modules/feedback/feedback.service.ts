import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { CreateFeedbackInput, FeedbackQueryInput } from "./feedback.validation";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";

export async function submitFeedback(payload: CreateFeedbackInput) {
  try {
    return await prisma.guestFeedback.create({
      data: {
        ...payload,
        contact: payload.contact ?? "",
      },
    });
  } catch (error: any) {
    if (error.code === "P2003") {
      throw appError("Branch not found or inactive", httpStatus.NOT_FOUND);
    }
    throw error;
  }
}

export async function getFeedbackById(id: number) {
  const feedback = await prisma.guestFeedback.findUnique({
    where: { id },
    include: { branch: { select: { name: true, code: true } } },
  });
  if (!feedback) throw appError("Feedback not found", httpStatus.NOT_FOUND);
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
    if (query.endDate) dateFilter.lte = new Date(query.endDate);
    where.submittedAt = dateFilter;
  }

  const [data, total] = await prisma.$transaction([
    prisma.guestFeedback.findMany({
      where,
      ...pagination,
      include: { branch: { select: { name: true, code: true } } },
    }),
    prisma.guestFeedback.count({ where }),
  ]);

  return { data, meta: buildMetadata(total, pagination) };
}
