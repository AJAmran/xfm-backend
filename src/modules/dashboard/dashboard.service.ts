import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";

export async function getSummary(branchId?: number) {
  const where: Prisma.FeedbackWhereInput = {};
  if (branchId) where.branchId = branchId;

  const [totalFeedbacks, avg, negative, distribution, recent] = await Promise.all([
    prisma.feedback.count({ where }),
    prisma.feedback.aggregate({
      where,
      _avg: {
        overallRating: true,
        foodRating: true,
        serviceRating: true,
        environmentRating: true,
        eventRating: true,
      },
    }),
    prisma.feedback.count({ where: { ...where, overallRating: { lte: 2 } } }),
    prisma.feedback.groupBy({
      by: ["overallRating"],
      where,
      _count: true,
      orderBy: { overallRating: "asc" },
    }),
    prisma.feedback.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: 10,
      select: {
        id: true,
        guestName: true,
        overallRating: true,
        submittedAt: true,
        opinion: true,
        branch: { select: { name: true, code: true } },
      },
    }),
  ]);

  return {
    totalFeedbacks,
    averageRatings: avg._avg,
    negativeFeedbackCount: negative,
    ratingDistribution: distribution.map((d) => ({ rating: d.overallRating, count: d._count })),
    recentFeedbacks: recent,
  };
}

export async function getRecentFeedback(branchId?: number) {
  const where: Prisma.FeedbackWhereInput = {};
  if (branchId) where.branchId = branchId;

  return prisma.feedback.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take: 20,
    select: {
      id: true,
      guestName: true,
      contact: true,
      overallRating: true,
      foodRating: true,
      serviceRating: true,
      environmentRating: true,
      eventRating: true,
      opinion: true,
      submittedAt: true,
      branch: { select: { name: true, code: true } },
    },
  });
}

/**
 * Returns branch ranking with names resolved in a single parallel fetch.
 * groupBy does not support include, so branch names are joined via a Map
 * from a concurrent branches query — no N+1.
 */
export async function getBranchRanking() {
  const [ranking, branches] = await Promise.all([
    prisma.feedback.groupBy({
      by: ["branchId"],
      _avg: {
        overallRating: true,
        foodRating: true,
        serviceRating: true,
        environmentRating: true,
        eventRating: true,
      },
      _count: true,
      orderBy: { _avg: { overallRating: "desc" } },
    }),
    prisma.branch.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, code: true },
    }),
  ]);

  const branchMap = new Map(branches.map((b) => [b.id, { name: b.name, code: b.code }]));

  return ranking.map((r) => ({
    branchId: r.branchId,
    branch: branchMap.get(r.branchId) ?? null,
    totalFeedbacks: r._count,
    averageRatings: r._avg,
  }));
}

export async function getNegativeFeedback(branchId?: number) {
  const where: Prisma.FeedbackWhereInput = { overallRating: { lte: 2 } };
  if (branchId) where.branchId = branchId;

  return prisma.feedback.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take: 50,
    select: {
      id: true,
      guestName: true,
      contact: true,
      overallRating: true,
      opinion: true,
      submittedAt: true,
      branch: { select: { name: true, code: true } },
    },
  });
}
