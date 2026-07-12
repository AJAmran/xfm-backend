import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";

export async function getRatingAnalytics(branchId?: number) {
  const where: Prisma.GuestFeedbackWhereInput = {};
  if (branchId) where.branchId = branchId;

  const [ratings, distribution] = await Promise.all([
    prisma.guestFeedback.aggregate({
      where,
      _avg: { overallRating: true, foodRating: true, serviceRating: true, environmentRating: true, eventRating: true },
      _count: true,
    }),
    prisma.guestFeedback.groupBy({
      by: ["overallRating"],
      where,
      _count: true,
      orderBy: { overallRating: "asc" },
    }),
  ]);

  const total = ratings._count;
  return {
    averages: ratings._avg,
    totalFeedbacks: total,
    distribution: distribution.map((d) => ({
      rating: d.overallRating,
      count: d._count,
      percentage: total ? Math.round((d._count / total) * 100) : 0,
    })),
  };
}

export async function getBranchPerformance() {
  const [branches, performance] = await Promise.all([
    prisma.branch.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        _count: { select: { feedback: true } },
      },
    }),
    prisma.guestFeedback.groupBy({
      by: ["branchId"],
      _avg: { overallRating: true, foodRating: true, serviceRating: true, environmentRating: true, eventRating: true },
    }),
  ]);

  // Build a Map for O(1) lookup instead of O(n) Array.find per branch.
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

/**
 * Returns monthly feedback trends using database-side aggregation.
 *
 * Instead of loading all rows into Node.js memory (which is O(N) in data
 * size), this uses a raw SQL GROUP BY with DATE_FORMAT to aggregate on the
 * MariaDB/MySQL side — returning only one row per month.
 *
 * Reference: https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries
 */
export async function getMonthlyTrends(branchId?: number) {
  // Build the WHERE clause dynamically for raw SQL.
  const conditions: Prisma.Sql[] = [];
  if (branchId) conditions.push(Prisma.sql`branch_id = ${branchId}`);

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

  // BigInt from COUNT(*) must be serialized to Number for JSON output.
  return rows.map((r) => ({
    month: r.month,
    averageRating: Number(r.average_rating),
    totalFeedbacks: Number(r.total_feedbacks),
  }));
}

export async function getCustomerSatisfaction(branchId?: number) {
  const where: Prisma.GuestFeedbackWhereInput = {};
  if (branchId) where.branchId = branchId;

  const [ratings, negative] = await Promise.all([
    prisma.guestFeedback.aggregate({
      where,
      _avg: { overallRating: true },
      _count: true,
    }),
    prisma.guestFeedback.count({ where: { ...where, overallRating: { lte: 2 } } }),
  ]);

  const total = ratings._count;
  const satisfactionRate = total ? Math.round(((total - negative) / total) * 100) : 0;

  return {
    satisfactionRate,
    totalFeedbacks: total,
    averageRating: ratings._avg.overallRating,
    negativeFeedbackCount: negative,
    category: satisfactionRate >= 80 ? "Excellent" : satisfactionRate >= 60 ? "Good" : "Needs Improvement",
  };
}
