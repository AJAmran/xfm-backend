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
  const conditions: Prisma.Sql[] = [];
  if (params.branchId) conditions.push(Prisma.sql`branch_id = ${params.branchId}`);
  if (params.startDate) conditions.push(Prisma.sql`submitted_at >= ${new Date(params.startDate)}`);
  if (params.endDate) {
    const end = new Date(params.endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(Prisma.sql`submitted_at <= ${end}`);
  }
  const whereSql =
    conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  // A single indexed scan yields every average, the total, and the full rating
  // distribution — on high-latency links this avoids two separate round-trips.
  const rows = await prisma.$queryRaw<
    {
      total: bigint;
      avg_overall: number | null;
      avg_food: number | null;
      avg_service: number | null;
      avg_environment: number | null;
      avg_event: number | null;
      r1: bigint;
      r2: bigint;
      r3: bigint;
      r4: bigint;
      r5: bigint;
      rnull: bigint;
    }[]
  >`
    SELECT
      COUNT(*)                                    AS total,
      AVG(overall_rating)                         AS avg_overall,
      AVG(food_rating)                            AS avg_food,
      AVG(service_rating)                         AS avg_service,
      AVG(environment_rating)                     AS avg_environment,
      AVG(event_rating)                           AS avg_event,
      SUM(overall_rating = 1)                     AS r1,
      SUM(overall_rating = 2)                     AS r2,
      SUM(overall_rating = 3)                     AS r3,
      SUM(overall_rating = 4)                     AS r4,
      SUM(overall_rating = 5)                     AS r5,
      SUM(overall_rating IS NULL)                 AS rnull
    FROM guest_feedbacks
    ${whereSql}
  `;

  const row = rows[0]!;
  const total = Number(row.total);
  const toNum = (v: number | null): number | null => (v === null ? null : Number(v));

  const distribution: { rating: number | null; count: number }[] = [
    { rating: 1, count: Number(row.r1) },
    { rating: 2, count: Number(row.r2) },
    { rating: 3, count: Number(row.r3) },
    { rating: 4, count: Number(row.r4) },
    { rating: 5, count: Number(row.r5) },
  ].filter((d) => d.count > 0);

  if (Number(row.rnull) > 0) distribution.push({ rating: null, count: Number(row.rnull) });

  return {
    averages: {
      overallRating: toNum(row.avg_overall),
      foodRating: toNum(row.avg_food),
      serviceRating: toNum(row.avg_service),
      environmentRating: toNum(row.avg_environment),
      eventRating: toNum(row.avg_event),
    },
    totalFeedbacks: total,
    distribution,
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
