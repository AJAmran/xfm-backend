# X-Group Feedback Backend — Onboarding Guide

## 1. Project Overview
**Business Purpose:** The X-Group Feedback Backend is a centralized REST API engineered to collect, manage, and analyze guest feedback across multiple restaurant branches. 
**Problem Solved:** It provides a seamless, ultra-fast channel for guests to submit feedback via QR codes placed inside restaurants, bypassing administrative friction to capture honest, real-time customer sentiment.
**Project Goals:** 
- Deliver fast (sub-300ms) feedback submissions to maximize user experience.
- Provide real-time dashboards and robust analytics to administrators and branch managers.
- Maintain a scalable, type-safe, and highly optimized database architecture.
**User Roles:** 
- `SUPER_ADMIN`: Global access to all branches, settings, and users.
- `ADMIN`: Regional/operational oversight.
- `BRANCH_MANAGER`: Scoped strictly to data and insights for their assigned branch.
**High-Level Workflow:** Guests submit feedback via frontend (Next.js). The API validates and stores the feedback, which is subsequently aggregated into real-time dashboards, periodic reports, and excel exports for management.

## 2. System Architecture
**Overall Architecture:** Monolithic Express API connected to a MariaDB relational database via Prisma ORM.
**Folder Structure:** 
- `src/app.ts` & `src/server.ts`: Application entry and bootstrapping.
- `src/modules/*`: Domain-driven module separation.
- `src/middleware/*`: Request interception (auth, validation, error handling).
- `src/utils/*`: Shared helpers (API responses, query builders).
- `prisma/schema/*`: Modularized Prisma schema definitions.
**Request Lifecycle:** 
`Router -> authGuard (if protected) -> validateSchema (Zod) -> Controller -> Service -> DB -> Service -> Controller -> successResponse`
**Module Relationships:** Strict encapsulation. Controllers never contain business logic. Services handle all business rules, orchestration, and Prisma interactions.
**Data Flow & Authentication:** Stateless REST. Authentication uses HttpOnly cookies OR an `Authorization: Bearer <token>` header, carrying a JWT.

## 3. Backend Technical Details
**Technologies:** Node.js (Express), TypeScript (Strict), Prisma ORM, MariaDB, Zod (Validation), ExcelJS (Exports).
**Coding Standards:** ES Modules (`"type": "module"`). Strict TypeScript (`any` is forbidden). Named exports exclusively (except for singletons). Kebab-case for files, camelCase for functions, PascalCase for types.
**API Conventions:** Base path is `/api/v1`. 
**Validation Flow:** Zod schemas applied via `validateSchema({ body, query, params })`.
**Error Handling:** Handled via custom `appError(message, statusCode)`. Errors are caught by a global error handler middleware.
**Response Format:**
- Success: `successResponse(res, "msg", data, statusCode)`
- Error: `errorResponse(res, "msg", errors, statusCode)`
**Prisma Conventions:** Schema is split into multiple `.prisma` files under `prisma/schema/`. Run `npx prisma generate` after changes. Use `import { prisma } from "../../lib/prisma"` to avoid connection pool exhaustion.
**Security & Performance:** `helmet` and `cors` are enabled. Analytical group-by queries must be date-bounded. Unbounded DB queries are strictly prohibited (enforced via `take` limits). 

## 4. Frontend Integration
**API Base URL:** `<BACKEND_URL>/api/v1`
**Authentication Method:** JWT via HttpOnly `accessToken` cookie or standard Bearer header.
**Pagination Format:** 
Endpoints return: `{ data: [...], meta: { page, limit, totalRecords, totalPages, hasNextPage, hasPreviousPage } }`
**Filtering & Sorting:** Pass via query params (e.g., `?page=1&limit=10&sortBy=submittedAt&sortOrder=desc&startDate=...`).
**Date Format:** ISO-8601 strings (e.g., `2026-07-13T12:00:00Z`).
**Error Response Format:** `{ success: false, message: string, errors?: array }`

## 5. Database Architecture
**Important Entities:** `Branch`, `User`, `GuestFeedback`.
**Business Rules & Relationships:** 
- A `Branch` has many `Users` (Managers) and `GuestFeedbacks`.
- Soft Delete is heavily utilized on `Branch` and `User` using the `isDeleted` boolean. **Always filter `isDeleted: false`**.
**Indexes & Constraints:** 
- Compound indexes exist on `[branchId, submittedAt]` and `[branchId, overallRating]` to heavily optimize dashboard aggregations.
- Enums are used for `Role`, `HeardAbout`, and `AgeGroup`.
- Table mapping uses snake_case (`@@map("guest_feedbacks")`) while Prisma models use PascalCase (`GuestFeedback`).

## 6. Business Logic Flows
**Feedback Submission:** Optimized for extreme speed. Relies exclusively on DB-level Foreign Key constraints (catching `P2003`) rather than preliminary lookups to validate branch existence. Ratings accept 1-5 to ensure no artificial barriers to negative feedback.
**Dashboard & Analytics:** Utilizes `Promise.all` for parallel execution of multi-metric aggregations. Uses Prisma `groupBy` combined with mandatory date bounds to avoid full table scans.
**Reports Flow:** Supports Daily, Weekly, and Monthly aggregations. Exporting to Excel uses a bounded limit (`REPORT_EXPORT_LIMIT`) to protect Node's heap memory.

## 7. Development Workflow
**Project Setup:** `npm install`
**Environment Variables:** Documented in `src/config/env.ts` (validated via Zod on startup). Requires `DATABASE_URL`, `JWT_*`, `PORT`.
**Commands:** 
- Dev Server: `npm run dev` (Runs on port 5000 by default)
- Type Checking: `npm run lint` (`tsc --noEmit`)
- Build: `npm run build` (Outputs to `dist/`)
- Seed: `npm run seed` (Populates DB with sample branches and roles)

## 8. AI Agent Instructions
**CRITICAL RULES FOR AI AGENTS:**
- **Never Change the Architecture:** Maintain the strict separation of Routes → Validation → Controller → Service. 
- **Soft Deletes Only:** Never write `prisma.user.delete()` or `prisma.branch.delete()`. Use `update({ data: { isDeleted: true } })`.
- **Query Bounds:** Never introduce unbounded `findMany` queries or historical `groupBy` queries without explicit pagination or `take` limits (e.g., relying on `env.report_fetch_limit`).
- **Imports:** Always import Prisma models/enums from `../../../generated/prisma/client` and the Prisma singleton from `../../lib/prisma`.
- **Performance First:** Guest submission endpoints must require the absolute minimum database roundtrips. Rely on database engine constraints (like FK errors) instead of pre-validating existence in code when optimizing for speed.

## 9. Missing Documentation / Gaps
- **Deployment Topology:** Currently missing documentation on CI/CD pipelines, Docker containerization, and hosting specifics (e.g., Vercel vs AWS ECS).
- **Caching Strategy:** The application relies entirely on MariaDB index performance. Future documentation should outline Redis implementation details if analytical queries begin overwhelming the database.
- **E2E Testing Constraints:** `test-all-endpoints.mjs` exists but lacks documentation on required mock data state before running.
