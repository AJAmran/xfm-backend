import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";

export interface AggregationParams {
  branchId?: number;
  startDate?: string;
  endDate?: string;
}

export function buildFeedbackWhere(params: AggregationParams): Prisma.GuestFeedbackWhereInput {
  const where: Prisma.GuestFeedbackWhereInput = {};
  if (params.branchId) where.branchId = params.branchId;
  if (params.startDate || params.endDate) {
    const dateFilter: Prisma.DateTimeFilter<"GuestFeedback"> = {};
    if (params.startDate) dateFilter.gte = new Date(params.startDate);
    if (params.endDate) {
      const end = new Date(params.endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.submittedAt = dateFilter;
  }
  return where;
}

export function getNegativeCount(distribution: { rating: number | null; count: number }[]): number {
  return distribution
    .filter((d) => d.rating !== null && d.rating <= 2)
    .reduce((sum, d) => sum + d.count, 0);
}

export async function getRatingStats(params: AggregationParams) {
  const where = buildFeedbackWhere(params);

  const [aggregation, distribution] = await Promise.all([
    prisma.guestFeedback.aggregate({
      where,
      _avg: {
        overallRating: true,
        foodRating: true,
        serviceRating: true,
        environmentRating: true,
        eventRating: true,
      },
      _count: true,
    }),
    prisma.guestFeedback.groupBy({
      by: ["overallRating"],
      where,
      _count: true,
      orderBy: { overallRating: "asc" },
    }),
  ]);

  return {
    averages: aggregation._avg,
    totalFeedbacks: aggregation._count,
    distribution: distribution.map((d) => ({
      rating: d.overallRating,
      count: d._count,
    })),
  };
}

export async function getSatisfactionMetrics(params: AggregationParams) {
  const stats = await getRatingStats(params);

  const negativeCount = getNegativeCount(stats.distribution);
  const satisfactionRate = stats.totalFeedbacks
    ? Math.round(((stats.totalFeedbacks - negativeCount) / stats.totalFeedbacks) * 100)
    : 0;

  return {
    satisfactionRate,
    totalFeedbacks: stats.totalFeedbacks,
    averageRating: stats.averages.overallRating,
    negativeFeedbackCount: negativeCount,
    category: satisfactionRate >= 80 ? "Excellent" : satisfactionRate >= 60 ? "Good" : "Needs Improvement",
  };
}
