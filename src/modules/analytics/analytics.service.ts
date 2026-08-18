import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { buildFeedbackWhere, getRatingStats, getSatisfactionMetrics } from "../../utils/feedbackAggregation";

import { withCache, invalidateByPrefix } from "../../lib/cache";

// ─── Cache invalidation ─────────────────────────────────────
// Any mutation to source data clears the derived analytics keys so
// the next dashboard render recomputes fresh numbers.
const ANALYTICS_PREFIXES = ["ratingStats_", "branchPerf_", "monthlyTrends_", "satisfaction_", "dashboard_summary_"];

// Feedback arrives in bursts (a dinner rush can submit dozens in a minute).
// Wiping every analytics key on each submission makes the dashboard recompute
// the full aggregation on every render — which on a remote, high-latency DB
// is the single biggest source of "dashboard jank". Coalesce invalidation to
// at most one wipe per window (leading edge): the first feedback of a burst
// invalidates, the rest ride the freshly computed caches, and data is at most
// one window stale.
const INVALIDATION_COALESCE_MS = 20_000;
let lastInvalidationAt = 0;

export async function invalidateAnalyticsCaches(branchId?: number | null): Promise<void> {
  // Ignore `branchId` here: caches are keyed per (branch × date-range) and a
  // new submission only ever adds rows, so clearing every derived key is the
  // simplest correct invalidation and costs microseconds with NodeCache.
  void branchId;

  const now = Date.now();
  if (now - lastInvalidationAt < INVALIDATION_COALESCE_MS) return;
  lastInvalidationAt = now;

  await invalidateByPrefix(...ANALYTICS_PREFIXES);
}

export async function getRatingAnalytics(branchId?: number, startDate?: string, endDate?: string) {
  const cacheKey = `ratingStats_${branchId || "all"}_${startDate || "none"}_${endDate || "none"}`;
  
  return withCache(cacheKey, async () => {
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
  }, 300); // 5 min TTL
}

export async function getBranchPerformance(startDate?: string, endDate?: string) {
  const cacheKey = `branchPerf_${startDate || "none"}_${endDate || "none"}`;
  
  return withCache(cacheKey, async () => {
    const where = buildFeedbackWhere({ startDate, endDate });

    // Counts come from the grouped aggregation rather than a correlated
    // per-branch subquery (`_count` on branch.findMany would run one COUNT per
    // branch) — this stays index-friendly even when aggregated across many
    // branches on a remote, high-latency DB.
    const [branches, performance, distribution] = await Promise.all([
      prisma.branch.findMany({
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, isActive: true },
      }),
      prisma.guestFeedback.groupBy({
        by: ["branchId"],
        where,
        _count: true,
        _avg: { overallRating: true, foodRating: true, serviceRating: true, environmentRating: true, eventRating: true },
      }),
      prisma.guestFeedback.groupBy({
        by: ["branchId", "overallRating"],
        where,
        _count: true,
      }),
    ]);

    const avgMap = new Map(performance.map((p) => [p.branchId, p._avg]));
    const countMap = new Map(performance.map((p) => [p.branchId, p._count]));
    const sentimentMap = new Map<number, { positive: number; negative: number }>();
    for (const d of distribution) {
      if (d.overallRating === null) continue;
      const entry = sentimentMap.get(d.branchId) ?? { positive: 0, negative: 0 };
      if (d.overallRating >= 4) entry.positive += d._count;
      else if (d.overallRating <= 2) entry.negative += d._count;
      sentimentMap.set(d.branchId, entry);
    }

    return branches.map((b) => {
      const sentiment = sentimentMap.get(b.id) ?? { positive: 0, negative: 0 };
      const total = countMap.get(b.id) ?? 0;
      return {
        id: b.id,
        name: b.name,
        code: b.code,
        isActive: b.isActive,
        totalFeedbacks: total,
        positiveFeedback: sentiment.positive,
        negativeFeedback: sentiment.negative,
        positivePercentage: total ? Math.round((sentiment.positive / total) * 100) : 0,
        negativePercentage: total ? Math.round((sentiment.negative / total) * 100) : 0,
        averageRatings: avgMap.get(b.id) ?? null,
      };
    });
  }, 300);
}

export async function getMonthlyTrends(branchId?: number, startDate?: string, endDate?: string) {
  const cacheKey = `monthlyTrends_${branchId || "all"}_${startDate || "none"}_${endDate || "none"}`;
  
  return withCache(cacheKey, async () => {
    const conditions: Prisma.Sql[] = [];
    if (branchId) conditions.push(Prisma.sql`branch_id = ${branchId}`);
    if (startDate) conditions.push(Prisma.sql`submitted_at >= ${new Date(startDate)}`);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(Prisma.sql`submitted_at <= ${end}`);
    }

    // Bound the unbounded case: without explicit dates the trend only needs the
    // last 12 months. This keeps the GROUP BY range-scan narrow instead of a
    // full-table aggregation whenever the dashboard is opened with no filters.
    if (!startDate) {
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
      conditions.push(Prisma.sql`submitted_at >= ${twelveMonthsAgo}`);
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
  }, 300);
}

export async function getCustomerSatisfaction(branchId?: number, startDate?: string, endDate?: string) {
  const cacheKey = `satisfaction_${branchId || "all"}_${startDate || "none"}_${endDate || "none"}`;
  return withCache(cacheKey, async () => {
    return getSatisfactionMetrics({ branchId, startDate, endDate });
  }, 300);
}

export async function getDashboardSummary(branchId?: number, startDate?: string, endDate?: string) {
  const cacheKey = `dashboard_summary_${branchId || "all"}_${startDate || "none"}_${endDate || "none"}`;

  return withCache(cacheKey, async () => {
    const params = { branchId, startDate, endDate };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());

    // Daily volume for the last 14 days (or the explicit range).
    const conditions: Prisma.Sql[] = [];
    if (branchId) conditions.push(Prisma.sql`branch_id = ${branchId}`);
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    conditions.push(Prisma.sql`submitted_at >= ${start}`);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(Prisma.sql`submitted_at <= ${end}`);
    }
    const whereClause =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

    // Every metric group is independent, so run them concurrently: the cold
    // dashboard load is ~1 round-trip "deep" instead of 5 sequential segments.
    const branchCond = branchId ? Prisma.sql`branch_id = ${branchId} AND ` : Prisma.empty;
    const [stats, trend, branchComparison, dailyRows, countRows] = await Promise.all([
      getRatingStats(params),
      getMonthlyTrends(branchId, startDate, endDate),
      getBranchPerformance(startDate, endDate),
      prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT
          DATE_FORMAT(submitted_at, '%b %d') AS date,
          COUNT(*)                           AS count
        FROM guest_feedbacks
        ${whereClause}
        GROUP BY date
        ORDER BY MIN(submitted_at) ASC
      `,
      prisma.$queryRaw<{ week: bigint; month: bigint }[]>`
        SELECT
          (SELECT COUNT(*) FROM guest_feedbacks WHERE ${branchCond} submitted_at >= ${startOfWeek}) AS week,
          (SELECT COUNT(*) FROM guest_feedbacks WHERE ${branchCond} submitted_at >= ${startOfMonth}) AS month
      `,
    ]);

    const thisWeekCount = Number(countRows[0]!.week);
    const thisMonthCount = Number(countRows[0]!.month);
    const daily = dailyRows.map((r) => ({ date: r.date, count: Number(r.count) }));

    // Sentiment from distribution:
    // Excellent(5)/Good(4) → Positive, Average(3) → Neutral, Poor(2) → Negative
    let positive = 0;
    let neutral = 0;
    let negative = 0;
    for (const d of stats.distribution) {
      if (d.rating !== null) {
        if (d.rating >= 4) positive += d.count;
        else if (d.rating === 3) neutral += d.count;
        else negative += d.count;
      }
    }

    const filteredBranches = branchId ? branchComparison.filter((b) => b.id === branchId) : branchComparison;

    return {
      totalFeedbacks: stats.totalFeedbacks,
      averageRating: stats.averages.overallRating,
      averages: stats.averages,
      distribution: stats.distribution,
      sentiment: { positive, neutral, negative, total: stats.totalFeedbacks },
      trend,
      branchComparison: {
        companyAvg: stats.averages.overallRating,
        branches: filteredBranches.map((b) => ({
          code: (b.code ?? b.name).substring(0, 8),
          average: b.averageRatings?.overallRating ?? 0,
        })),
      },
      branchReports: filteredBranches.map((b) => {
        const avg = b.averageRatings?.overallRating ?? 0;
        return {
          branchName: b.name,
          totalFeedback: b.totalFeedbacks,
          averageRating: parseFloat(avg.toFixed(1)),
          positiveFeedback: b.positiveFeedback ?? 0,
          negativeFeedback: b.negativeFeedback ?? 0,
          positivePercentage: b.positivePercentage ?? 0,
          negativePercentage: b.negativePercentage ?? 0,
        };
      }),
      daily,
      thisWeek: thisWeekCount,
      thisMonth: thisMonthCount,
    };
  }, 60);
}
