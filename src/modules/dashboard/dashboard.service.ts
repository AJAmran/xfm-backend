import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { buildFeedbackWhere, getRatingStats, getNegativeCount } from "../../utils/feedbackAggregation";

export async function getSummary(branchId?: number, startDate?: string, endDate?: string) {
  const params = { branchId, startDate, endDate };
  const where = buildFeedbackWhere(params);

  const [stats, recent] = await Promise.all([
    getRatingStats(params),
    prisma.guestFeedback.findMany({
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
    totalFeedbacks: stats.totalFeedbacks,
    averageRatings: stats.averages,
    negativeFeedbackCount: getNegativeCount(stats.distribution),
    ratingDistribution: stats.distribution,
    recentFeedbacks: recent,
  };
}

export async function getRecentFeedback(branchId?: number, startDate?: string, endDate?: string) {
  const where = buildFeedbackWhere({ branchId, startDate, endDate });

  return prisma.guestFeedback.findMany({
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

export async function getBranchRanking(startDate?: string, endDate?: string) {
  const where = buildFeedbackWhere({ startDate, endDate });

  const [ranking, branches] = await Promise.all([
    prisma.guestFeedback.groupBy({
      by: ["branchId"],
      where,
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

export async function getNegativeFeedback(branchId?: number, startDate?: string, endDate?: string) {
  const where: Prisma.GuestFeedbackWhereInput = { overallRating: { lte: 2 } };
  if (branchId) where.branchId = branchId;
  if (startDate || endDate) {
    const dateFilter: Prisma.DateTimeFilter<"GuestFeedback"> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.submittedAt = dateFilter;
  }

  return prisma.guestFeedback.findMany({
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
