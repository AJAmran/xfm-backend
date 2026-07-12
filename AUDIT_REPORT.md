# Production Audit Report — X-Group Feedback Backend

**Date:** July 12, 2026
**Auditor:** Senior Staff Backend Engineer
**Project:** X-Group Feedback Management System (XFMS) v1.0
**Stack:** Express 5 + TypeScript 7 + Prisma 7 + MariaDB

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [High Severity Issues](#high-severity-issues)
3. [Medium Severity Issues](#medium-severity-issues)
4. [Low Severity Issues](#low-severity-issues)
5. [Executive Summary](#executive-summary)
6. [Priority Roadmap](#priority-roadmap)
7. [Final Checklist](#final-checklist)

---

## Critical Issues

### C1: Global Rate Limiter Completely Disabled

**Severity:** Critical

**Current Situation:**
The global rate limiter (`globalLimiter`) is imported in `src/app.ts:9` but commented out at `src/app.ts:33`. Only the auth-specific limiter (`authLimiter`) is active. The entire API surface outside of `/auth/login` has no rate limiting whatsoever.

**Why It Matters:**
- The feedback submission endpoint (`POST /feedbacks`) is fully public with no authentication
- Any attacker can flood the system with spam feedback entries, consuming database write capacity
- Dashboard, analytics, and reports endpoints are equally unprotected — a malicious authenticated user or compromised token can issue unlimited rapid requests
- Without rate limiting, a single misbehaving client or a coordinated DDoS can exhaust database connection pool, CPU, and memory, causing cascading failure across all services

**Recommended Improvement:**
Re-enable the global rate limiter with a reasonable window/max configuration. Consider tiered rate limiting: strict for public endpoints (feedback submission), moderate for authenticated read endpoints, and relaxed for internal health checks.

**Expected Benefits:**
- Prevents abuse of the public feedback submission endpoint
- Protects database from write amplification attacks
- Adds a critical layer of DDoS mitigation
- Complies with OWASP API Top 10 (API4:2023 — Unrestricted Resource Consumption)

**Breaking Change:** No

---

### C2: Reports Service References Wrong Prisma Model (`feedback`)

**Severity:** Critical

**Current Situation:**
The entire `src/modules/reports/reports.service.ts` uses `prisma.feedback` (e.g., lines 8, 19, 21, 22, 75, 96) instead of `prisma.guestFeedback`. The Prisma model is defined as `GuestFeedback` with `@@map("guest_feedbacks")`.

**Why It Matters:**
- Every single reports endpoint will crash at runtime with a TypeScript compilation error or Prisma runtime error because the model `feedback` does not exist
- This affects: `GET /reports/daily`, `/reports/weekly`, `/reports/monthly`, `/reports/branch`, `/reports/export/excel`
- The E2E test script may not catch this if the test assertions are too lenient (the test only checks for 2xx status codes)
- This would make the entire reports module completely non-functional in production

**Recommended Improvement:**
Rename all `prisma.feedback` references to `prisma.guestFeedback` across the reports service file.

**Expected Benefits:**
- Restores full functionality to all report endpoints
- Eliminates guaranteed runtime failures

**Breaking Change:** No

---

### C3: Public Feedback Submission Has No Abuse Prevention

**Severity:** Critical

**Current Situation:**
`POST /feedbacks` is a public endpoint (no `authGuard` middleware) with no rate limiting, no CAPTCHA, no honeypot fields, and no per-IP or per-session throttling. The only protection is the 10kb payload size limit.

**Why It Matters:**
- Anyone can programmatically submit unlimited feedback entries with fake data
- A simple script can flood the database with millions of garbage records
- This degrades query performance on dashboard/analytics/reports queries, wastes storage, and pollutes real data
- Since the feedback form is intended for QR-code-scanned restaurant guests, there is no practical user authentication; abuse prevention must come from rate limiting and request validation

**Recommended Improvement:**
Implement a dedicated strict rate limiter for the feedback submission endpoint (e.g., 5 requests per 15 minutes per IP). Consider adding a CAPTCHA (reCAPTCHA v3 or Turnstile) for production deployment. Add per-IP tracking with exponential backoff for repeat offenders.

**Expected Benefits:**
- Prevents database pollution from spam submissions
- Preserves data quality for analytics and reporting
- Protects database write capacity

**Breaking Change:** No

---

## High Severity Issues

### H1: No Input Validation on Dashboard, Analytics, and Reports Endpoints

**Severity:** High

**Current Situation:**
The `dashboard/`, `analytics/`, and `reports/` modules are missing validation files (`*.validation.ts`). Route parameters and query strings are not validated via `validateSchema()` middleware. Controllers blindly cast `req.query` without schema guarantees.

**Why It Matters:**
- Malformed query parameters (e.g., invalid date strings, unexpected data types) can reach Prisma queries and cause runtime errors or unexpected behavior
- Missing validation creates an inconsistent developer experience — some modules validate inputs, others don't
- Type safety is compromised: the TypeScript compiler cannot catch injection of invalid query shapes
- Inconsistent error responses: validation errors from these endpoints may leak raw system errors instead of sanitized messages

**Recommended Improvement:**
Create Zod validation schemas for all dashboard, analytics, and reports query parameters. Apply them via `validateSchema({ query: ... })` middleware. Key parameters to validate: date ranges, branch IDs, page/limit values.

**Expected Benefits:**
- Consistent input validation across all modules
- Better error messages for API consumers
- Protection against query parameter injection
- Improved type safety and DX

**Breaking Change:** No

---

### H2: No Request ID / Correlation ID for Request Tracing

**Severity:** High

**Current Situation:**
The custom logger in `src/middleware/logger.ts` logs method, URL, status, duration, and IP but does not include a unique request identifier. There is no `X-Request-Id` header generated or propagated.

**Why It Matters:**
- Without correlation IDs, debugging production issues requires correlating logs by timestamp alone, which is imprecise under load
- Cannot trace a single request's path through the system when multiple requests are interleaved
- No way for API consumers to reference specific requests when reporting errors
- Industry standard (OpenTelemetry, AWS, GCP, Datadog all rely on trace IDs)

**Recommended Improvement:**
Generate a UUID (`crypto.randomUUID()`) per request via middleware, attach it to `req` object, include it in all log lines, and return it as `X-Request-Id` response header.

**Expected Benefits:**
- Dramatically simplifies debugging in production
- Enables API consumers to reference specific requests in support tickets
- Foundation for future distributed tracing and OpenTelemetry integration

**Breaking Change:** No

---

### H3: No Structured Logging (Production-Unsafe Logging)

**Severity:** High

**Current Situation:**
All logging uses raw `console.log` and `console.error` across the codebase: the custom logger, the error handler, the server bootstrap, and the Prisma slow-query hook. No log levels, no JSON formatting, no transport layers.

**Why It Matters:**
- `console.log` writes to stdout/stderr without structured formatting, making it difficult to parse with log aggregation tools (ELK, Datadog, Splunk)
- No log levels mean you cannot filter by severity in production — debug/info/warn/error are all mixed
- Error stack traces may be truncated depending on the runtime
- JSON-formatted logs are the industry standard for production Node.js applications
- OWASP API Top 10 (API7:2023 — Security Misconfiguration) recommends proper logging

**Recommended Improvement:**
Adopt a logging library (e.g., `pino` for its industry-leading performance) or add a lightweight JSON formatter to the existing logger. Include structured fields: timestamp, level, requestId, method, url, statusCode, duration, ip, and optional error stacks.

**Expected Benefits:**
- Production-grade log output ready for ingestion by log aggregators
- Ability to filter, search, and alert on log levels
- Consistent format across all logging points

**Breaking Change:** No

---

### H4: Soft-Delete Filter Not Enforced at Prisma Client Level

**Severity:** High

**Current Situation:**
Soft-delete filtering (`isDeleted: false`) is manually added to every Prisma query by each service. There is no middleware, `@@where` filter, or Prisma client-level interceptor to enforce this globally. Several queries may be missing the filter (e.g., `createBranch` code uniqueness check at `branch.service.ts:18` does not filter `isDeleted: false`).

**Why It Matters:**
- A query missing `isDeleted: false` will return soft-deleted records, potentially exposing deleted data
- `createBranch` code uniqueness check on line 18 could incorrectly reject a new branch code that matches a soft-deleted branch's code
- Manual filtering is error-prone and violates DRY — every new query must remember to add the filter
- As the codebase grows, the probability of missing this filter increases

**Recommended Improvement:**
Implement a Prisma client middleware (using `$extends`) or a `Prisma.Client`-level wrapper that automatically appends `isDeleted: false` to all `findUnique`, `findFirst`, `findMany`, `count`, and `aggregate` queries on models that have an `isDeleted` field. Use `update` with `where: { isDeleted: false }` as a guard.

**Expected Benefits:**
- Eliminates an entire class of bugs
- Removes boilerplate from every service file
- Ensures consistent soft-delete enforcement as the codebase grows

**Breaking Change:** No

---

### H5: Missing CORS Hardening

**Severity:** High

**Current Situation:**
CORS is configured with `origin: env.app_url` and `credentials: true` in `src/app.ts:23`. There is no whitelist of allowed origins, no allowed methods restriction, no allowed headers restriction, and no handling of preflight (OPTIONS) requests.

**Why It Matters:**
- While `origin` restricts to one domain, there is no mechanism to support multiple allowed origins (e.g., staging, production, localhost)
- By default, Express CORS allows all methods and headers — unnecessary attack surface
- No explicit `optionsSuccessStatus` for legacy browser support
- Per OWASP, CORS should be as restrictive as possible

**Recommended Improvement:**
Configure CORS with explicit `methods`, `allowedHeaders`, and `credentials: true`. Support an origin whitelist via environment variable. Handle preflight requests explicitly.

**Expected Benefits:**
- Reduced attack surface
- Support for multiple allowed origins via configuration
- Production-hardened CORS policy

**Breaking Change:** No

---

### H6: Reports Branch Query Allows BRANCH_MANAGER to Access Any Branch

**Severity:** High

**Current Situation:**
In `src/modules/reports/reports.controller.ts:24`, the branch endpoint reads `req.query.branchId` directly without validating it against the authenticated user's branch. For BRANCH_MANAGER role, it correctly uses `req.user.branchId!`. But for other roles, any `branchId` is accepted without verifying the user has access to that branch.

**Why It Matters:**
- An authenticated user (ADMIN role expected to have global access) is fine, but the code lacks a consistent authorization check pattern
- If a misconfigured or future role is introduced, this could leak data
- The inconsistency between how `branchId` is extracted here vs. in dashboard/analytics controllers suggests a pattern that could be refactored into reusable middleware

**Recommended Improvement:**
Create a reusable utility in the controller layer that resolves the effective branch ID from auth context and validates it against the user's role. Apply it consistently across dashboard, analytics, and reports controllers.

**Expected Benefits:**
- Consistent authorization logic across all modules
- Reduced code duplication
- Easier to audit and maintain

**Breaking Change:** No

---

### H7: Type Cast without Validation in Controllers

**Severity:** High

**Current Situation:**
Several controllers use `as unknown as` type casts to bypass TypeScript type checking on query parameters (e.g., `user.controller.ts:18`, `branch.controller.ts:18`, `feedback.controller.ts:18`). The actual validation happens via Zod middleware.

**Why It Matters:**
- These type assertions subvert TypeScript's type safety
- If the Zod validation middleware is accidentally omitted or misconfigured, the controller will receive untyped, potentially dangerous data without any TypeScript error
- Creates a false sense of type safety

**Recommended Improvement:**
Instead of casting `as unknown as T`, use Zod's inferred types properly. The `validateSchema` middleware could attach parsed/typed data to `res.locals` or a custom property on `req`, avoiding the need for casts entirely.

**Expected Benefits:**
- True compile-time type safety for validated inputs
- Eliminates risk of bypassing validation pipelines

**Breaking Change:** Yes — would require refactoring the validation middleware interface

---

## Medium Severity Issues

### M1: Naming Inconsistency in Route Files

**Severity:** Medium

**Current Situation:**
Route files use inconsistent naming:
- `auth.route.ts` exports `AuthRoutes` (named const)
- `user.routes.ts` exports `{ router as UserRoutes }` (file named `.routes.ts`)
- `branch.routes.ts`, `feedback.routes.ts` — also `.routes.ts`
- The `auth` module is the only one using `.route.ts`
- Export style varies: `export const AuthRoutes = route;` vs `export { router as UserRoutes }`

**Why It Matters:**
- Inconsistency makes the codebase harder to navigate and reason about
- New contributors may follow the wrong convention
- File search (`*.route.ts`) misses 7 out of 8 route files

**Recommended Improvement:**
Standardize on a single naming convention across all modules. The auth module's pattern (`module.route.ts` + `export const ModuleRoutes = route`) is cleaner and should be adopted universally.

**Expected Benefits:**
- Consistent, predictable file structure
- Easier for tooling and developers to locate route files

**Breaking Change:** No — import aliases handle the rename

---

### M2: `any` Type in Branch Service

**Severity:** Medium

**Current Situation:**
`branch.service.ts:8` uses `const formatBranch = (branch: any) => {` — `any` type suppresses all TypeScript checking.

**Why It Matters:**
- Violates the project's stated convention of "Strict TypeScript — no `any`"
- If the branch object structure changes, this function will not produce compile-time errors
- The function accesses properties (`branch.latitude`, `branch.longitude`) that may not exist at runtime

**Recommended Improvement:**
Define a proper type for the branch parameter (either the Prisma-generated `Branch` type or a Pick<> subset). Use optional chaining if the fields may be absent.

**Expected Benefits:**
- Restores type safety
- Catches property mismatches at compile time
- Aligns with project conventions

**Breaking Change:** No

---

### M3: Route Definition Formatting Bug in Branch Routes

**Severity:** Medium

**Current Situation:**
`branch.routes.ts:10` has two statements on one line separated by a newline:
```ts
router.get("/active", branchController.listActive);router.use(authGuard(Role.SUPER_ADMIN, Role.ADMIN));
```

**Why It Matters:**
- While functionally correct, this is a formatting error that indicates rushed code
- Reduces readability and suggests lack of review
- The auth guard for the rest of the routes could be confused with the public `/active` route

**Recommended Improvement:**
Place the `router.use()` statement on its own line for clarity.

**Expected Benefits:**
- Improved readability
- Clear separation of public vs protected routes

**Breaking Change:** No

---

### M4: No Pagination on Dashboard, Analytics, and Reports Endpoints

**Severity:** Medium

**Current Situation:**
Dashboard summary, branch ranking, negative feedback, analytics, and reports endpoints return all matching data without pagination. The `getNegativeFeedback` service takes only 50 records, and `getRecentFeedback` takes 20, but the summaries and aggregated results have no limit/skip controls.

**Why It Matters:**
- As the business grows and feedback volume increases (thousands to millions of records), these endpoints will become slower
- Dashboard queries that aggregate over all records or return many rows will consume increasing database and memory resources
- No cursor or keyset pagination on high-volume queries

**Recommended Improvement:**
Audit each endpoint for data growth potential. Add pagination parameters (page/limit) where appropriate. For aggregate endpoints, consider time-bounding (e.g., "last 30 days") as a default filter.

**Expected Benefits:**
- Consistent API design across all modules
- Future-proofing against data growth
- Predictable response sizes

**Breaking Change:** Yes — may change response format for existing consumers

---

### M5: Hardcoded Excel Export Row Limit

**Severity:** Medium

**Current Situation:**
`reports.service.ts:100` hardcodes `take: 10000` for Excel exports. This could silently truncate data for large branches or wide date ranges.

**Why It Matters:**
- Export produces incomplete data without warning the user
- 10,000 may be too few for a busy nationwide restaurant chain
- Hardcoded value is not configurable per environment

**Recommended Improvement:**
Make the export limit configurable via environment variable with a sensible default. Add a warning in the response if truncation occurs (e.g., include the total count and exported count in the response, or set a header).

**Expected Benefits:**
- Flexible configuration per deployment
- User awareness of data completeness
- Production-tunable limits

**Breaking Change:** No

---

### M6: No Input Validation for Excel Export Date Parameters

**Severity:** Medium

**Current Situation:**
The `exportExcel` controller accepts `startDate` and `endDate` as raw query strings (reports.controller.ts:31-32) without any validation. Invalid date strings will cause `new Date(invalid)` to produce `Invalid Date`, which Prisma will interpret differently.

**Why It Matters:**
- API consumers receive no feedback about invalid date formats
- `Invalid Date` comparisons in Prisma queries produce unpredictable results
- Inconsistent with the validation-first approach used elsewhere in the app

**Recommended Improvement:**
Add Zod validation for the export endpoint query parameters, including proper date format validation (ISO 8601) and optional branchId validation.

**Expected Benefits:**
- Consistent validation across all endpoints
- Clear error messages for invalid parameters
- Protection against query misinterpretation

**Breaking Change:** No

---

### M7: No CSRF Protection for Cookie-Based Auth

**Severity:** Medium

**Current Situation:**
The application sets HttpOnly cookies for auth tokens (`accessToken`, `refreshToken`) and uses `credentials: true` in CORS. However, there is no CSRF token mechanism.

**Why It Matters:**
- While HttpOnly cookies cannot be read by JavaScript (mitigating XSS-based token theft), they are still automatically sent by the browser on every request to the origin
- A CSRF attack could trick a logged-in admin's browser into making state-changing requests (e.g., delete users, deactivate branches)
- The SameSite cookie attribute is set conditionally to `"none"` in production with Secure flag, which mitigates CSRF for cross-site requests but does not eliminate it

**Recommended Improvement:**
Evaluate whether cookie-based auth is needed. If so, implement CSRF tokens using the double-submit cookie pattern or integrate a CSRF middleware (e.g., `csurf` or a custom implementation). Consider SameSite=Strict for most endpoints.

**Expected Benefits:**
- Protection against CSRF attacks on state-changing endpoints
- Defense-in-depth for cookie-based authentication

**Breaking Change:** No — CSRF implementation is additive

---

### M8: Shutdown Handler Calls `process.exit(0)`

**Severity:** Medium

**Current Situation:**
`src/server.ts:18` calls `process.exit(0)` after `prisma.$disconnect()` in the shutdown handler. This terminates the process forcibly.

**Why It Matters:**
- `process.exit(0)` does not wait for pending async operations to complete
- In-flight HTTP requests or database queries may be aborted mid-execution
- The recommended pattern is to call `server.close()` which stops accepting new connections and drains existing ones, then let the process exit naturally when the event loop is empty

**Recommended Improvement:**
Remove `process.exit(0)` from the shutdown handler. Allow Node.js to exit naturally once the server closes and pending operations complete. Set a forced exit timeout as a safety net.

**Expected Benefits:**
- Graceful connection draining
- No aborted in-flight requests
- Industry-standard graceful shutdown pattern

**Breaking Change:** No

---

### M9: Migrations Out of Sync with Config Path

**Severity:** Medium

**Current Situation:**
Prisma is configured with `prisma.config.ts` using Vercel-compatible config format, but the `prisma/schema/` directory holds split schema files while `prisma/migrations/` holds migration history. The `package.json` has no explicit `prisma` schema path configured.

**Why It Matters:**
- Developers may accidentally run `npx prisma migrate dev` without the custom config, which defaults to `prisma/schema.prisma` — a file that exists but only contains the generator/datasource configuration
- This could lead to lost migrations or schema drift
- The migration workflow is not documented in the project

**Recommended Improvement:**
Add a `"prisma"` section to `package.json` referencing the config file, or update the documentation to specify `npx prisma --config prisma.config.ts`.

**Expected Benefits:**
- Clear, documented migration workflow
- Reduced risk of schema drift
- Better developer experience

**Breaking Change:** No

---

### M10: Health Check Does Not Verify Database Connectivity

**Severity:** Medium

**Current Situation:**
`GET /api/v1/health` returns a static response with process uptime but does not verify that the database connection is alive.

**Why It Matters:**
- A health check should confirm that all critical dependencies are operational
- If the database connection pool is exhausted or the database is unreachable, the health check will still return 200 OK
- Load balancers and orchestrators (Kubernetes, Docker) rely on health checks for routing decisions

**Recommended Improvement:**
Add a lightweight DB connectivity check to the health endpoint: `await prisma.$queryRaw\`SELECT 1\``. Return 503 if the database is unreachable.

**Expected Benefits:**
- Accurate health reporting for orchestration systems
- Early detection of database connectivity issues
- Industry-standard health check pattern

**Breaking Change:** No

---

## Low Severity Issues

### L1: Password Validation Uses Only Minimum Length

**Severity:** Low

**Current Situation:**
Auth validation (`auth.validation.ts:5`) only requires `z.string().min(8)` for passwords. The user creation schema (`user.validation.ts:7`) has the same.

**Why It Matters:**
- Weak passwords are a common attack vector
- No requirement for complexity (uppercase, lowercase, numbers, special characters)
- No maximum length, which could allow extremely long passwords that cause hash computation slowdowns

**Recommended Improvement:**
Add password strength validation: minimum 8 characters, require at least one uppercase letter, one lowercase letter, one digit, and one special character. Add a reasonable maximum length (e.g., 128 characters).

**Expected Benefits:**
- Improved account security
- Defense against brute-force and credential-stuffing attacks
- Consistent with OWASP authentication guidelines

**Breaking Change:** Yes — existing users' passwords remain valid, but new registrations require stronger passwords

---

### L2: Dashboard Branch Ranking Allows ADMIN Only (Inconsistent Pattern)

**Severity:** Low

**Current Situation:**
`dashboard.routes.ts:12` restricts branch ranking to `SUPER_ADMIN, ADMIN`, while `analytics.routes.ts:11` has the same restriction for branch performance. However, other endpoints follow the same role pattern inconsistently.

**Why It Matters:**
- Minor inconsistency in authorization granularity
- BRANCH_MANAGER cannot see branch rankings but can see other dashboard data — this is likely by design but not documented
- The pattern could be centralized into a single authorization rule

**Recommended Improvement:**
Document the RBAC matrix explicitly. Consider creating a route-level permission map rather than repeating role arrays.

**Expected Benefits:**
- Clear documentation of authorization rules
- Easier to audit and modify permissions

**Breaking Change:** No

---

### L3: `prisma.feedback` vs `prisma.guestFeedback` Inconsistency in Reports

**Severity:** Low (handled as Critical in C2)

**Current Situation:**
The reports module uses `prisma.feedback` which does not exist. This is already captured as C2 (Critical) but the fact that TypeScript compilation (`tsc --noEmit`) did not catch this suggests potential gaps in the type checking pipeline.

**Why It Matters:**
- Raises questions about whether `npm run lint` (`tsc --noEmit`) is properly catching all issues
- The generated Prisma client types should have flagged this

**Recommended Improvement:**
Investigate why `tsc --noEmit` did not catch this error. Ensure the generated Prisma client is properly included in the TypeScript project. Add the generated types directory to `tsconfig.json` includes.

**Expected Benefits:**
- Stronger type checking coverage
- Catches similar issues before deployment

**Breaking Change:** No

---

### L4: No Environment Variable Validation Schema

**Severity:** Low

**Current Situation:**
`src/config/env.ts` uses a custom `required()` function that throws if a mandatory variable is missing. However, there is no Zod schema validation for environment variables, and no type coercion beyond basic `Number()` conversion.

**Why It Matters:**
- Invalid values (e.g., `PORT=abc`) produce `NaN` silently
- Missing fallback values may mask configuration errors
- TypeScript types are not inferred from env vars — the config object has implicit `any` types for some properties

**Recommended Improvement:**
Use Zod to validate and parse environment variables at startup, providing clear error messages for each invalid variable.

**Expected Benefits:**
- Fail-fast on misconfiguration
- Self-documenting environment variable requirements
- Coerced and validated types

**Breaking Change:** No

---

### L5: Unused Dependencies

**Severity:** Low

**Current Situation:**
`package.json` lists `morgan` as a dependency but the codebase uses a custom `requestLogger` instead of morgan.

**Why It Matters:**
- Unnecessary dependency bloat increases the attack surface and install time
- Confusing for developers who may wonder why morgan is present but unused

**Recommended Improvement:**
Remove `morgan` from dependencies.

**Expected Benefits:**
- Smaller dependency footprint
- Clearer dependency inventory

**Breaking Change:** No

---

### L6: No Unit or Integration Test Framework

**Severity:** Low

**Current Situation:**
The project has no unit/integration test framework installed. `vitest` is referenced in `package.json` scripts (`"test:watch": "vitest"`) but is not listed as a dependency. The only test assets are the manual E2E script (`test-all-endpoints.mjs`) and the manual `TEST.md` guide.

**Why It Matters:**
- No automated regression testing for business logic in services
- The E2E test requires a running server and database, making it unsuitable for CI-fast feedback loops
- Changes to service logic cannot be validated without manual testing or full E2E runs

**Recommended Improvement:**
Install vitest (already declared in scripts), write unit tests for core services (auth, user, queryBuilder) and integration tests for critical DB queries. The E2E script can remain as a pre-deployment smoke test.

**Expected Benefits:**
- Fast feedback on code changes
- Regression protection for business logic
- CI integration capability
- Improved developer confidence

**Breaking Change:** No

---

### L7: No `.env.example` File

**Severity:** Low

**Current Situation:**
The project has a `.env` file (gitignored) but no `.env.example` documenting all required environment variables.

**Why It Matters:**
- New developers must reverse-engineer required env vars from `env.ts`
- Onboarding friction for new team members
- CI/CD environments must be configured without documentation

**Recommended Improvement:**
Create a `.env.example` file with all required variables, their descriptions, and example values. Ensure it stays in sync with `env.ts`.

**Expected Benefits:**
- Improved developer onboarding
- Documented configuration requirements
- CI/CD setup reference

**Breaking Change:** No

---

### L8: Manual Seed Prisma Instance Duplication

**Severity:** Low

**Current Situation:**
`prisma/seed.ts` creates its own Prisma client instance (lines 9-10) instead of importing the shared singleton from `src/lib/prisma.ts`.

**Why It Matters:**
- Code duplication — the adapter configuration logic is duplicated
- If the Prisma configuration changes (e.g., logging settings), the seed script must be updated separately
- Minor maintenance burden

**Recommended Improvement:**
Import `prisma` from `../src/lib/prisma.ts` in the seed script. The seed script already imports `dotenv/config` anyway.

**Expected Benefits:**
- Single source of truth for Prisma configuration
- Reduced code duplication

**Breaking Change:** No

---

## Executive Summary

### Overall Architecture Score: **72/100**

The project follows a clean, modular architecture with a consistent 4-file module pattern. The separation of concerns (routes → controllers → services → DB) is well-defined and maintainable. However, inconsistencies in naming, missing validation in several modules, and the critical bug in the reports module lower the score.

### Code Quality Score: **65/100**

Strong TypeScript conventions with strict mode, but usage of `any`, inconsistent type casting (`as unknown as`), missing validation files, and the critical reports model bug indicate quality gaps. The codebase benefits from clear naming conventions and modular organization.

### Security Score: **58/100**

The most concerning finding is the global rate limiter being completely disabled, leaving the public feedback endpoint unprotected. Auth/JWT handling is well-structured, and the minimal DB select in auth middleware is a good practice. However, no CSRF protection, no CAPTCHA, no request logging with correlation IDs, and no input validation on multiple endpoints create significant security gaps.

### Performance Score: **70/100**

Good use of `Promise.all()` for parallel queries, raw SQL for monthly trends, and compound indexes. However, the commented-out rate limiter leaves the system vulnerable to resource exhaustion. No caching strategy exists for frequently queried dashboard data. The Excel export's hardcoded limit could mask performance issues.

### Scalability Score: **68/100**

The architecture is horizontally scalable as a stateless API (JWT auth, no in-memory session state). Pagination is implemented correctly where it exists (user, branch, feedback modules), but missing on dashboard, analytics, and reports endpoints. No caching layer (Redis) for aggregated dashboard queries that could benefit from memoization. Raw SQL for monthly trends is a good optimization.

### Database Design Score: **78/100**

Well-designed schema with proper indexes, soft deletes, snake_case mapping, and compound indexes for common query patterns (branchId + submittedAt, branchId + overallRating). The MariaDB adapter with connection pooling is appropriate. Minor issues: the `phone` field in branches stores comma-separated strings instead of a proper related table or JSON, and there is no explicit index on `overallRating` alone.

### API Design Score: **70/100**

Consistent response envelope (`success: true, message, data`) and pagination metadata are good. Base URL prefixing (`/api/v1`) and RESTful resource naming are correct. However, the inconsistency in route file naming, missing validation on multiple endpoints, and the unimplemented PDF export (returning a 200 with a "future update" message) detract from the score.

### Maintainability Score: **68/100**

The modular architecture is a strength. However, naming inconsistencies between modules, the critical bug in reports (wrong model name), missing validation files, and lack of test coverage reduce maintainability. The code is generally readable with clear function naming and absence of excessive comments.

### Production Readiness Score: **55/100**

**Not ready for production.** The critical issues — disabled global rate limiter, broken reports module, and unprotected public feedback endpoint — must be resolved before deployment. Additional concerns: no structured logging, no request tracing, no CSRF protection, no proper database health check, no automated test suite, and no caching strategy.

---

## Priority Roadmap

### Phase 1 — Must Fix Before Production

| # | Issue | Severity | Effort |
|---|---|---|---|
| C1 | Global rate limiter disabled | Critical | Low |
| C2 | Reports service uses wrong model (`prisma.feedback`) | Critical | Low |
| C3 | Public feedback has no abuse prevention | Critical | Medium |
| H1 | Missing input validation on dashboard/analytics/reports | High | Medium |
| H3 | No structured logging | High | Medium |
| H5 | Missing CORS hardening | High | Low |
| M10 | Health check does not verify DB connectivity | Medium | Low |
| M8 | `process.exit(0)` in shutdown handler | Medium | Low |
| M6 | No validation on Excel export date params | Medium | Low |

### Phase 2 — High Priority Improvements

| # | Issue | Severity | Effort |
|---|---|---|---|
| H2 | No request ID / correlation ID | High | Low |
| H4 | Soft-delete filter not enforced at Prisma level | High | Medium |
| H6 | Reports branch query allows unauthorized access | High | Low |
| H7 | Type casts without validation in controllers | High | Medium |
| M1 | Naming inconsistency in route files | Medium | Low |
| M2 | `any` type in branch service | Medium | Low |
| M3 | Route definition formatting in branch routes | Medium | Low |
| M9 | Migration config path inconsistency | Medium | Low |
| M7 | No CSRF protection | Medium | Medium |

### Phase 3 — Nice-to-Have Improvements

| # | Issue | Severity | Effort |
|---|---|---|---|
| M4 | No pagination on dashboard/analytics/reports | Medium | High |
| M5 | Hardcoded Excel export limit | Medium | Low |
| L1 | Password validation too lenient | Low | Low |
| L2 | RBAC inconsistency on branch ranking | Low | Low |
| L3 | TypeScript not catching missing model | Low | Low |
| L4 | No env var validation schema | Low | Low |
| L5 | Unused morgan dependency | Low | Low |
| L6 | No unit/integration test framework | Low | High |
| L7 | No `.env.example` file | Low | Low |
| L8 | Seed Prisma instance duplication | Low | Low |

---

## Final Checklist

### Security & Rate Limiting
- [ ] C1: Re-enable global rate limiter with tiered configuration
- [ ] C3: Add strict rate limiter for public feedback submission
- [ ] C3: Implement CAPTCHA or equivalent abuse prevention
- [ ] H5: Harden CORS configuration with explicit methods/origins
- [ ] M7: Implement CSRF protection for cookie-based auth

### Bug Fixes
- [ ] C2: Fix `prisma.feedback` → `prisma.guestFeedback` in reports service
- [ ] M2: Replace `any` type in `formatBranch` with proper type
- [ ] M3: Fix formatting of branch routes (separate `router.use` onto its own line)

### Validation & Type Safety
- [ ] H1: Create Zod schemas for dashboard, analytics, reports query params
- [ ] H7: Eliminate `as unknown as` casts via proper validation middleware typing
- [ ] M6: Add Zod validation for Excel export query parameters
- [ ] L1: Strengthen password validation rules
- [ ] L4: Add Zod env var validation schema

### Authentication & Authorization
- [ ] H6: Standardize branchId resolution in reports controller
- [ ] L2: Document and centralize RBAC permission matrix

### Logging & Monitoring
- [ ] H2: Add request ID generation and propagation middleware
- [ ] H3: Replace console.log with structured JSON logging
- [ ] M10: Add database connectivity check to health endpoint

### Database & Prisma
- [ ] H4: Implement Prisma middleware for global soft-delete filtering
- [ ] M9: Document or automate Prisma migration workflow
- [ ] L8: Refactor seed to import shared Prisma client

### API Design
- [ ] M1: Standardize route file naming convention across all modules
- [ ] M4: Add pagination to dashboard, analytics, and reports endpoints
- [ ] M5: Make Excel export limit configurable

### Infrastructure & Deployment
- [ ] M8: Remove `process.exit(0)` from shutdown handler
- [ ] L7: Create `.env.example` file

### Testing & Quality
- [ ] L3: Investigate TypeScript not catching missing Prisma model
- [ ] L5: Remove unused morgan dependency
- [ ] L6: Install vitest and write unit/integration tests

---

*End of Audit Report — 30 issues identified (3 Critical, 7 High, 10 Medium, 8 Low)*
