import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { buildFeedbackWhere, getRatingStats, getSatisfactionMetrics } from "../../utils/feedbackAggregation";

export async function getRatingAnalytics(branchId?: number, startDate?: string, endDate?: string) {
  const params = { branchId, startDate, endDate };
  const stats = await getRatingStats(params);

  return {
    averages: stats.averages,
    totalFeedbacks: stats.totalFeedbacks,
    distribution: stats.distribution.map((d) => ({
      rating: d.rating,
      count: d.count,
      percentage: stats.totalFeedbacks ? Math.round((d.count / stats.totalFeedbacks) * 100) : 0,
    })),
  };
}

export async function getBranchPerformance(startDate?: string, endDate?: string) {
  const where = buildFeedbackWhere({ startDate, endDate });

  const [branches, performance] = await Promise.all([
    prisma.branch.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        _count: { select: { feedback: { where } } },
      },
    }),
    prisma.guestFeedback.groupBy({
      by: ["branchId"],
      where,
      _avg: { overallRating: true, foodRating: true, serviceRating: true, environmentRating: true, eventRating: true },
    }),
  ]);

  const perfMap = new Map(performance.map((p) => [p.branchId, p._avg]));

  return branches.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    isActive: b.isActive,
    totalFeedbacks: b._count.feedback,
    averageRatings: perfMap.get(b.id) ?? null,
  }));
}

export async function getMonthlyTrends(branchId?: number, startDate?: string, endDate?: string) {
  const conditions: Prisma.Sql[] = [];
  if (branchId) conditions.push(Prisma.sql`branch_id = ${branchId}`);
  if (startDate) conditions.push(Prisma.sql`submitted_at >= ${new Date(startDate)}`);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(Prisma.sql`submitted_at <= ${end}`);
  }

  const whereClause =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<
    { month: string; average_rating: number; total_feedbacks: bigint }[]
  >`
    SELECT
      DATE_FORMAT(submitted_at, '%Y-%m')           AS month,
      ROUND(AVG(overall_rating), 1)                AS average_rating,
      COUNT(*)                                     AS total_feedbacks
    FROM guest_feedbacks
    ${whereClause}
    GROUP BY month
    ORDER BY month ASC
  `;

  return rows.map((r) => ({
    month: r.month,
    averageRating: Number(r.average_rating),
    totalFeedbacks: Number(r.total_feedbacks),
  }));
}

export async function getCustomerSatisfaction(branchId?: number, startDate?: string, endDate?: string) {
  return getSatisfactionMetrics({ branchId, startDate, endDate });
}
