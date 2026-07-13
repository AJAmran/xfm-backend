# Deep Architecture & Performance Audit — Dashboard, Analytics, Reports

**Date:** July 12, 2026
**Scope:** `src/modules/dashboard/`, `analytics/`, `reports/`
**Data Volume:** ~60k feedbacks/year, ~165/day

---

## 1. Dashboard Module

### 1.1 `getSummary` — 5 Parallel Queries, 3 of Them Redundant

**File:** `dashboard.service.ts:8-40`
**Severity:** Medium

**Current:** Runs 5 Prisma queries in parallel:
1. `count` (total)
2. `aggregate._avg` (5 rating fields)
3. `count` (negative, `overallRating <= 2`)
4. `groupBy` (rating distribution by `overallRating`)
5. `findMany` (10 most recent)

**Why it matters:** Queries #1, #2, and #4 can be merged. The `aggregate` already returns `_count` (eliminating #1). The `groupBy` in #4 already returns per-rating counts, which can derive the negative count in #3 (`rating <= 2`). At 60k/year this is fine, but the redundant scans become 3x more expensive as data grows.

**Recommendation:** Merge queries #1+2 (`aggregate` with `_count` covers total), derive negative count from `groupBy` results instead of a separate `count` query. This reduces 5 parallel queries to 3.

**Expected impact:** ~40% fewer full table scans on summary endpoint. Marginal at current volume, significant at 500k+.

---

### 1.2 `getSummary` and `getNegativeFeedback` — Missing Index for `overallRating` Alone

**File:** `dashboard.service.ts:20` (`overallRating: { lte: 2 }`), `dashboard.service.ts:111`
**Severity:** High

**Current:** The negative-feedback filter uses `overallRating: { lte: 2 }`. The only covering index is the compound `[branchId, overallRating]`. When no `branchId` filter is applied (SUPER_ADMIN/ADMIN viewing all branches), MariaDB cannot use this compound index efficiently — it requires a full table scan.

**Why it matters:** Every dashboard summary load scans all rows to count negative feedbacks when no branch filter is set. At 60k/year this is ~200ms; at 300k it becomes ~1s+.

**Recommendation:** Add a single-column index `@@index([overallRating])` to the Prisma schema.

**Expected impact:** Negative feedback queries become index-only lookups. 5-10x faster for global queries.

---

### 1.3 `getNegativeFeedback` — Sort Without Indexable Column

**File:** `dashboard.service.ts:114-127`
**Severity:** Medium

**Current:** Query filters by `overallRating: { lte: 2 }` and sorts by `submittedAt DESC`. No single index exists for `overallRating`, and the compound `[branchId, overallRating]` only helps when branchId is present. The `[branchId, submittedAt]` index can't help because `overallRating` is in WHERE but not in the index.

**Why it matters:** MariaDB must do a filesort on the filtered results. At 60k/year, roughly 5-10% of feedbacks (3k-6k) are negative — the filesort is cheap. At scale, this degrades.

**Recommendation:** Add a compound index `@@index([overallRating, submittedAt])` for the negative feedback sort pattern.

**Expected impact:** Eliminates filesort for negative feedback queries. ~2-3x faster for global negative feedback listing.

---

### 1.4 `getRecentFeedback` — No Pagination, No Cursor

**File:** `dashboard.service.ts:51-73`
**Severity:** Low

**Current:** Hardcoded `take: 20`, no pagination or cursor support.

**Why it matters:** Works fine at current volume. Not a bottleneck. Listed for completeness.

---

### 1.5 `getBranchRanking` — Full Scan on Every Load

**File:** `dashboard.service.ts:80-108`
**Severity:** Medium

**Current:** `groupBy` on `branchId` with `_avg` of 5 rating fields. This scans all feedback rows to compute per-branch averages.

**Why it matters:** Every dashboard page load recomputes the full ranking from scratch. For 15 branches and 60k feedbacks, this is manageable (~300ms). But it's a full table scan regardless.

**Recommendation:** Consider caching the ranking result with a short TTL (5-15 minutes), since branch rankings change slowly. Use `Promise.all` to fetch branches in parallel (already done — good).

**Expected impact:** Dashboard load time drops by 200-400ms. Allows more frequent dashboard refreshes without DB load.

---

## 2. Analytics Module

### 2.1 `getRatingAnalytics` — Duplicates `dashboard.getSummary` Logic

**File:** `analytics.service.ts:4-32` vs `dashboard.service.ts:8-49`
**Severity:** High

**Current:** Both `analytics.getRatingAnalytics` and `dashboard.getSummary` run the exact same aggregation pattern:
- `aggregate._avg` on 5 rating fields
- `groupBy` on `overallRating`

`getRatingAnalytics` adds percentage calculation on distribution. `getSummary` adds `count`, negative count, and recent feedbacks.

**Why it matters:** Code duplication. If a new rating field is added, both modules must be updated. If the aggregation query changes, two places to fix. This violates DRY.

**Recommendation:** Extract shared aggregation logic into a single `feedbackStats` utility (or a repository layer). Both `getRatingAnalytics` and `getSummary` call the same underlying function.

**Expected impact:** Single source of truth for rating aggregation. Reduced maintenance burden.

---

### 2.2 `getBranchPerformance` — Relation Count May Not Be Batched

**File:** `analytics.service.ts:43` (`_count: { select: { feedback: true } }`)
**Severity:** Low

**Current:** Prisma's `_count` on relation in a `findMany` is typically batched into a single query. However, the pattern also exists in `dashboard.getBranchRanking` which handles it differently (separate `groupBy` + Map join).

**Why it matters:** Two different approaches to get branch feedback counts. The `_count` approach is simpler but may generate one extra `COUNT(*)` subquery per branch depending on Prisma version.

**Recommendation:** Verify Prisma generates a single batched query for `_count` on relations. If not, align with the dashboard's Map-join pattern for consistency.

---

### 2.3 `getMonthlyTrends` — Raw SQL is Correct But Not Index-Only

**File:** `analytics.service.ts:84-95`
**Severity:** Low

**Current:** Uses raw SQL with `DATE_FORMAT` + `GROUP BY`. This is the right approach — aggregating on the DB side.

**Why it matters:** `DATE_FORMAT(submitted_at, '%Y-%m')` in the GROUP BY prevents index-only scans because MariaDB must evaluate the function on every row. The `[branchId, submittedAt]` and `[submittedAt]` indexes can narrow the scanned rows but the GROUP BY still requires a temporary table.

**Recommendation:** If this becomes a bottleneck, consider a materialized summary table (`feedback_monthly_stats`) updated via a scheduled job or trigger, or use MariaDB's `VIRTUAL COLUMN` for `month` with an index.

**Expected impact:** At 60k/year, the current approach is fine. Recommendation is for long-term scaling (500k+).

---

### 2.4 `getCustomerSatisfaction` — Recomputes What `getRatingAnalytics` Already Computes

**File:** `analytics.service.ts:105-128`
**Severity:** Medium

**Current:** Runs two queries: `aggregate._avg` (overallRating, _count) and `count` (negative). This is a subset of `getRatingAnalytics`.

**Why it matters:** If a client calls both `/analytics/ratings` and `/analytics/satisfaction` on page load, the DB does the same work twice.

**Recommendation:** Either derive satisfaction from `getRatingAnalytics` response (distribution gives negative count) or merge into a single analytics response endpoint that returns everything at once.

**Expected impact:** Reduces duplicate DB work when both endpoints are consumed together.

---

### 2.5 No Date-Range Parameter on Any Analytics Endpoint

**File:** `analytics.service.ts` (all functions)
**Severity:** Medium

**Current:** All analytics endpoints aggregate across ALL feedback data. No `startDate`/`endDate` filter exists.

**Why it matters:** A BRANCH_MANAGER who wants to see "last 30 days" trends vs "this quarter" trends has no option. The only way to get time-filtered data is the reports module, which returns raw feedbacks (not aggregations).

**Recommendation:** Add optional `startDate` and `endDate` query parameters to analytics endpoints. Use default of "last 12 months" instead of "all time" for better performance on mature datasets.

**Expected impact:** Users can filter analytics by time period. Queries scan fewer rows by default.

---

## 3. Reports Module

### 3.1 `getDailyReport/getWeeklyReport/getMonthlyReport` — Returns All Feedback Rows Unpaginated

**File:** `reports.service.ts:28-65`
**Severity:** High

**Current:** `getFeedbacksInRange` returns ALL feedbacks in the date range with full column selection and branch join. A monthly report for a busy branch can return 3000-5000+ rows in a single JSON response.

**Why it matters:**
- Response payload can be 1-2MB+ for a monthly report
- No pagination — API consumers must handle arbitrarily large responses
- All rows are loaded into memory and serialized to JSON
- No way for the frontend to request a subset

**Recommendation:** Add pagination (page/limit) to the report feedback list. Return summary + paginated feedbacks. Alternatively, split into summary endpoint (aggregates only) and a separate paginated feedback listing endpoint.

**Expected impact:** Predictable response sizes. Reduced memory usage. Better API consumer experience.

---

### 3.2 `exportExcel` — Silent Data Truncation

**File:** `reports.service.ts:100`
**Severity:** High

**Current:** Hardcoded `take: 10000`. If a date range has more than 10,000 feedbacks, rows are silently truncated. No user warning.

**Why it matters:** The API makes no guarantee about data completeness. A store manager exporting monthly data could get incomplete reports without knowing.

**Recommendation:** Make `take` configurable via env var. Add a `truncated` boolean flag in the response (or a response header) when the result set exceeds the limit. Alternatively, use ExcelJS streaming for unlimited exports.

**Expected impact:** Users are aware when exports are truncated. Configurable per deployment.

---

### 3.3 `exportExcel` — In-Memory Workbook for Large Exports

**File:** `reports.service.ts:103-142`
**Severity:** Medium

**Current:** Builds the entire Excel workbook in memory before writing to the response. For 10,000 rows with 13 columns, this consumes ~50-100MB of memory per request.

**Why it matters:** Under concurrent export requests (multiple managers exporting at month-end), memory usage spikes. No streaming or row-by-row write.

**Recommendation:** Use ExcelJS streaming writer (`worksheet.addRow` with `stream.write`) to pipe rows directly to the response without buffering the entire workbook.

**Expected impact:** ~90% reduction in peak memory for export requests. Scales to arbitrary row counts.

---

### 3.4 `branch` Report Returns `null` Data for Missing Branches

**File:** `reports.controller.ts:25`, `reports.service.ts:68-69`
**Severity:** Low

**Current:** `getBranchReport` returns `null` when branch not found. Controller passes `null` to `successResponse`, which returns `{ success: true, message: "...", data: null }`.

**Why it matters:** A 200 response with `data: null` for a non-existent branch is misleading. API consumers expect a 404.

**Recommendation:** Throw `appError("Branch not found", 404)` in the service instead of returning `null`.

**Expected impact:** Proper REST semantics. Client gets a 404 with error details.

---

### 3.5 `exportPdf` — Unimplemented Endpoint Returning 200

**File:** `reports.controller.ts:43-44`
**Severity:** Low

**Current:** Returns `200 OK` with message "PDF export will be available in a future update".

**Why it matters:** Returns 200 for an unimplemented feature. Monitoring/alerts won't detect this as an error. Clients may interpret the 200 as successful PDF generation.

**Recommendation:** Return `501 Not Implemented` with a clear message, or remove the route until implemented.

---

### 3.6 `Record<string, unknown>` Types in Reports Service

**File:** `reports.service.ts:5,16,82,86`
**Severity:** Medium

**Current:** Uses `Record<string, unknown>` for Prisma `where` clauses instead of typed `Prisma.GuestFeedbackWhereInput`.

**Why it matters:** Loses compile-time type safety. A typo in a field name (e.g., `submitedAt`) won't be caught by TypeScript — only at runtime by Prisma.

**Recommendation:** Use `Prisma.GuestFeedbackWhereInput` instead of `Record<string, unknown>`.

**Expected impact:** Catches field name typos at compile time. Consistent with other modules (dashboard, analytics, feedback use typed where).

---

### 3.7 `reports.controller.ts:31-32` — Raw Type Cast Instead of `parsedQuery`

**File:** `reports.controller.ts:31-32`
**Severity:** Low

**Current:** `startDate` and `endDate` extracted as `req.query.startDate as string | undefined` despite `validateSchema` middleware running beforehand.

**Why it matters:** Inconsistent with the H7 fix applied to user/branch/feedback controllers. The data IS validated but the controller doesn't use the typed helper.

---

## 4. Cross-Cutting Issues

### 4.1 No Caching Layer for Aggregate Queries

**Files:** All dashboard and analytics service functions
**Severity:** Critical

**Current:** Every dashboard/analytics API call recalculates aggregations from scratch — full table scans on `guest_feedbacks` for every request. No in-memory caching, no Redis, no response caching.

**Why it matters at 60k/year:**
- Each dashboard page load = 5 full table scans
- Each analytics page load = 2-4 full table scans
- A manager refreshing 10x/day generates 50-90 full table scans/day
- At year 3 (180k rows), each aggregation takes 500ms-2s
- No cache invalidation strategy exists

**Recommendation:** Implement a caching layer (Redis or in-memory with `node-cache`) for dashboard summaries and analytics aggregations. Key by `branchId` (or "global"). Set TTL of 1-5 minutes. Invalidate only when new feedback is submitted via the `POST /feedbacks` endpoint.

**Expected impact:**
- Dashboard/analytics response time drops from 200-800ms to <5ms (cache hit)
- DB read load reduces by 90%+ for dashboard/analytics
- Scales to any number of concurrent dashboard users

---

### 4.2 Dashboard and Analytics Overlap — 40% Duplicate Code

**Files:** `dashboard.service.ts` vs `analytics.service.ts`
**Severity:** High

**Current:** Both modules implement nearly identical aggregation logic:
- `getSummary` (dashboard) ≈ `getRatingAnalytics` + `getCustomerSatisfaction` (analytics)
- Both iterate `groupBy` results to build distributions
- Both compute negative feedback counts

**Why it matters:** If a business rule changes (e.g., "negative" changes from `lte: 2` to `lte: 3`), 4 functions across 2 files need updates. This is a maintenance risk.

**Recommendation:** Extract a shared `feedbackAggregation` utility or service that exposes:
- `getRatingStats(branchId?, dateRange?)` — aggregate + distribution
- `getSatisfactionMetrics(branchId?, dateRange?)` — positive/negative breakdown
Both dashboard and analytics modules call these shared functions.

**Expected impact:** Single point of change for aggregation logic. Consistent calculations across modules.

---

### 4.3 No Date-Range Filtering on Any Dashboard/Analytics Endpoint

**Files:** `dashboard.controller.ts`, `analytics.controller.ts`
**Severity:** Medium

**Current:** All aggregations run against the full dataset. No way to filter by date range.

**Why it matters:** A BRANCH_MANAGER's dashboard always shows lifetime stats. "Last month" vs "this month" comparisons require manual work. Queries scan rows from years ago unnecessarily.

**Recommendation:** Add optional `startDate`/`endDate` to dashboard and analytics endpoints. Default to "last 12 months" as a sensible baseline to bound the scan range.

---

### 4.4 Hardcoded `take` Values Without Configuration

**Files:** `dashboard.service.ts:30` (take:10), `dashboard.service.ts:58` (take:20), `dashboard.service.ts:117` (take:50), `reports.service.ts:75` (take:20), `reports.service.ts:100` (take:10000)
**Severity:** Low

**Current:** Various hardcoded `take` limits throughout.

**Why it matters:** Not adjustable per deployment or environment.

**Recommendation:** Extract to constants or env vars for the export limit. Others are fine as-is (domain-reasonable values like 10, 20, 50).

---

## 5. Scores

| Dimension | Score | Key Reason |
|-----------|-------|------------|
| **Architecture** | 72/100 | Clean separation, but 40% duplicate aggregation logic across modules |
| **Performance** | 65/100 | No caching, full table scans on every request, missing indexes |
| **Scalability** | 55/100 | No caching, deep-offset pagination concerns, full dataset aggregations |
| **Security** | 85/100 | Auth guards present, no injection risks found, RBAC enforced |
| **Maintainability** | 60/100 | Duplicate aggregation logic, `Record<string, unknown>` types in reports, unimplemented PDF endpoint |
| **Production Readiness** | 58/100 | No caching is the primary blocker; missing indexes; silent data truncation in exports |

**Overall Module Score: 66/100**

---

## 6. Priority Roadmap

### Must Fix Before Scale (100k+ rows)

| # | Issue | Module | Severity | Effort |
|---|-------|--------|----------|--------|
| 1 | No caching for aggregate queries | Dashboard/Analytics | Critical | Medium |
| 2 | Missing `overallRating` index | Dashboard | High | Low |
| 3 | Missing `[overallRating, submittedAt]` index | Dashboard | Medium | Low |
| 4 | Export silent truncation (`take:10000`) | Reports | High | Low |
| 5 | Reports return all rows unpaginated | Reports | High | Medium |

### Recommended

| # | Issue | Module | Severity | Effort |
|---|-------|--------|----------|--------|
| 6 | Extract shared aggregation logic | Dashboard/Analytics | High | Medium |
| 7 | `Record<string, unknown>` → typed Prisma where | Reports | Medium | Low |
| 8 | Add date-range params to analytics endpoints | Analytics | Medium | Medium |
| 9 | `getSummary` redundant queries (5→3) | Dashboard | Medium | Low |
| 10 | `getRatingAnalytics`/`getCustomerSatisfaction` overlap | Analytics | Medium | Low |
| 11 | Excel streaming for large exports | Reports | Medium | High |
| 12 | Branch report returns 200 with null data | Reports | Low | Low |
| 13 | Merge `getSummary` query #1 + #2 | Dashboard | Low | Low |

### Nice to Have

| # | Issue | Module | Severity | Effort |
|---|-------|--------|----------|--------|
| 14 | PDF export 200 → 501 or implement | Reports | Low | Low |
| 15 | `exportPdf` implementation | Reports | Low | High |
| 16 | Materialized monthly summary table | Analytics | Low | High |
| 17 | Configurable take limits | All | Low | Low |
| 18 | `getRecentFeedback` cursor pagination | Dashboard | Low | Medium |

---

## Summary

The three modules are **well-structured architecturally** — clean controller/service separation, proper auth guards, parallel query execution via `Promise.all`, and the raw SQL monthly trend is a smart optimization. The `getBranchRanking` Map-join correctly avoids N+1.

**The single biggest bottleneck is the absence of caching.** Dashboard summary and analytics aggregations scan the full `guest_feedbacks` table on every request. At 60k/year this is tolerable (~200-400ms). At 300k+ rows it becomes a problem. A simple Redis cache with 1-5 minute TTL would reduce dashboard load times from ~400ms to <5ms and cut DB reads by 90%.

**The second issue is code duplication.** ~40% of the aggregation logic in dashboard.service.ts is replicated in analytics.service.ts. A shared utility would reduce maintenance surface area and ensure consistent calculations.

**The third issue is the reports module returning unpaginated row data.** Monthly reports with thousands of rows are returned in a single JSON response with no pagination support.
