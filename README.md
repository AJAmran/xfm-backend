# X-Group Feedback Management System — Backend API

A production-grade REST API for collecting, managing, and analysing guest feedback across all X-Group restaurant branches in Dhaka.

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [API Reference](#api-reference)
- [Document Approval & E-Signature](#document-approval--e-signature)
- [Authentication](#authentication)
- [Role Permissions Matrix](#role-permissions-matrix)
- [Error Handling](#error-handling)
- [Performance Features](#performance-features)
- [Security](#security)
- [Scripts](#scripts)

---

## Overview

The X-Group Feedback System allows restaurant guests to submit feedback forms (no login required). Branch managers and admins can log in to view analytics, download reports, and manage users. The system supports three user roles with granular access control.

**Key capabilities:**

- Guest feedback submission (public, rate-limited)
- Role-based dashboard and analytics
- Excel report export per branch or date range
- JWT authentication with HttpOnly cookie + Bearer token support

---

## Technology Stack

| Layer            | Technology                       | Version       |
| ---------------- | -------------------------------- | ------------- |
| Runtime          | Node.js                          | 20+           |
| Language         | TypeScript                       | 7.x           |
| Framework        | Express.js                       | 5.x           |
| ORM              | Prisma                           | 7.x           |
| Database         | MariaDB / MySQL                  | (Aiven cloud) |
| DB Driver        | `@prisma/adapter-mariadb`        | 7.x           |
| Auth             | JSON Web Tokens (`jsonwebtoken`) | 9.x           |
| Password Hashing | `bcrypt`                         | 6.x           |
| Validation       | Zod                              | 4.x           |
| Compression      | `compression`                    | 1.x           |
| Security Headers | `helmet`                         | 8.x           |
| Rate Limiting    | `express-rate-limit`             | 8.x           |
| Excel Export     | `exceljs`                        | 4.x           |
| Dev Runner       | `tsx`                            | 4.x           |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Express App                       │
│                                                     │
│  helmet → cors → cookies → json → compression       │
│  → requestLogger → globalLimiter                    │
│                        │                            │
│         ┌──────────────┼──────────────┐             │
│         ▼              ▼              ▼             │
│    Public Routes   Auth Routes   Protected Routes   │
│    (feedback,      (login,        (dashboard,       │
│     branches-      refresh,       analytics,        │
│     active,        logout, me)    reports,          │
│     settings-get)                 users,            │
│                                   branches-manage)  │
│                        │                            │
│              authGuard middleware                   │
│              (JWT verify → minimal DB select)       │
│                        │                            │
│              Controllers → Services → Prisma ORM   │
│                                         │           │
│                                    MariaDB (Aiven)  │
└─────────────────────────────────────────────────────┘
```

### Module Structure

Each feature module follows a strict 4-layer pattern:

```
module/
  ├── module.route.ts       → Express Router + middleware wiring
  ├── module.controller.ts  → HTTP layer (req/res only, no business logic)
  ├── module.service.ts     → Business logic, DB queries via Prisma
  └── module.validation.ts  → Zod schemas (input validation)
```

---

## Project Structure

```
x-group-feedback-backend/
├── prisma/
│   ├── schema/
│   │   ├── schema.prisma       ← generator + datasource config
│   │   ├── branch.prisma       ← Branch model
│   │   ├── feedback.prisma     ← Feedback model (with compound indexes)
│   │   ├── user.prisma         ← User model
│   │   ├── setting.prisma      ← SystemSetting model
│   │   └── enum.prisma         ← Role, HeardAbout, AgeGroup enums
│   ├── migrations/             ← Prisma migration history
│   └── seed.ts                 ← Database seeder
│
├── src/
│   ├── app.ts                  ← Express app (middleware + routes)
│   ├── server.ts               ← Server bootstrap + graceful shutdown
│   ├── config/
│   │   └── env.ts              ← Validated environment config
│   ├── lib/
│   │   └── prisma.ts           ← Prisma client singleton
│   ├── middleware/
│   │   ├── auth.ts             ← JWT authGuard + role check
│   │   ├── errorHandler.ts     ← Global error handler (Prisma error mapping)
│   │   ├── logger.ts           ← Request logger (method, status, response time)
│   │   ├── rateLimiter.ts      ← Centralized rate limiter instances
│   │   └── validation.ts       ← Zod schema validation middleware
│   ├── modules/
│   │   ├── auth/               ← Login, logout, refresh, /me
│   │   ├── user/               ← User CRUD (admin only)
│   │   ├── branch/             ← Branch CRUD + public active list
│   │   ├── feedback/           ← Guest submission + paginated list
│   │   ├── dashboard/          ← Summary, recent, negative, ranking
│   │   ├── analytics/          ← Ratings, branch perf, monthly trends
│   │   ├── reports/            ← Daily/weekly/monthly/branch + Excel export
│   │   └── settings/           ← System settings (key-value store)
│   ├── types/
│   │   └── express.d.ts        ← Extends Express Request with req.user
│   └── utils/
│       ├── apiResponse.ts      ← successResponse / errorResponse helpers
│       ├── appError.ts         ← Operational error factory
│       ├── jwtHelpers.ts       ← JWT sign / verify wrappers
│       └── queryBuilder.ts     ← Pagination + sort parser (with max limits)
│
├── generated/
│   └── prisma/                 ← Auto-generated Prisma client
├── .env                        ← Environment variables (not committed)
├── prisma.config.ts            ← Prisma CLI configuration
├── tsconfig.json               ← TypeScript config (strict mode)
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- A MariaDB or MySQL database (local or [Aiven](https://aiven.io))

### Installation

```bash
# 1. Install dependencies (also runs prisma generate via postinstall)
npm install

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT secrets, etc.

# 3. Push schema to the database
npx prisma db push

# 4. Seed the database with branches, users, and sample feedback
npm run seed

# 5. Start the development server
npm run dev
```

The server starts at `http://localhost:5000`.

---

## Environment Variables

| Variable                 | Required | Default                 | Description                               |
| ------------------------ | -------- | ----------------------- | ----------------------------------------- |
| `DATABASE_URL`           | ✅       | —                       | MariaDB/MySQL connection string           |
| `PORT`                   | ❌       | `5000`                  | HTTP server port                          |
| `APP_URL`                | ✅       | `http://localhost:3000` | Frontend origin for CORS                  |
| `JWT_ACCESS_SECRET`      | ✅       | —                       | Secret for signing access tokens          |
| `JWT_REFRESH_SECRET`     | ✅       | —                       | Secret for signing refresh tokens         |
| `JWT_ACCESS_EXPIRES_IN`  | ❌       | `15m`                   | Access token TTL (e.g. `15m`, `1h`, `1d`) |
| `JWT_REFRESH_EXPIRES_IN` | ❌       | `7d`                    | Refresh token TTL (e.g. `7d`, `30d`)      |
| `SALT_ROUNDS`            | ❌       | `12`                    | bcrypt cost factor                        |
| `NODE_ENV`               | ❌       | `development`           | `development` or `production`             |

> **Production note:** Set strong random values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Use `openssl rand -base64 64` to generate them.

### DATABASE_URL Format

```
mysql://USER:PASSWORD@HOST:PORT/DATABASE?ssl-mode=REQUIRED
```

To configure the MariaDB connection pool, append query parameters:

```
mysql://...?connection_limit=10&pool_timeout=30
```

---

## Database

### Schema Overview

```
Branch ──────┬── User (branchId FK)
             └── Feedback (branchId FK)

Setting (standalone key-value table)
```

### Enums

| Enum         | Values                                                          |
| ------------ | --------------------------------------------------------------- |
| `Role`       | `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`, `COO`, `MD`            |
| `HeardAbout` | `SOCIAL_MEDIA`, `FRIENDS_AND_FAMILY`, `VISITED_BEFORE`          |
| `AgeGroup`   | `BELOW_18`, `AGE_18_30`, `AGE_31_45`, `AGE_45_PLUS`              |

### Indexes

The `guest_feedbacks` table has the following indexes:

- `(branch_id)` — standard FK index
- `(submitted_at)` — time-range queries
- `(branch_id, submitted_at)` — compound: branch + date-range (reports)
- `(branch_id, overall_rating)` — compound: branch + rating filter (negative feedback dashboard)

### Seeded Data

After `npm run seed`:

| Type      | Count                                                        |
| --------- | ------------------------------------------------------------ |
| Branches  | 15 (all X-Group Dhaka locations)                             |
| Users     | 19 (1 super admin, 1 admin, 1 COO, 1 MD, 15 branch managers)  |
| Feedbacks | 120 (spread across last 6 months)                            |
| Settings  | 5 default key-value entries                                  |

**Seeded credentials:**

| Role                  | Email                              | Password               |
| --------------------- | ---------------------------------- | ---------------------- |
| Super Admin           | `superadmin@x-grouprestaurant.com` | `SuperAdmin@123`       |
| Admin                 | `admin@x-grouprestaurant.com`      | `Admin@123`            |
| COO                   | `coo@x-grouprestaurant.com`    | `Coo@2026`             |
| MD                    | `md@x-grouprestaurant.com`         | `Managingderector@2026`|
| Branch Manager (X-01) | `xian@x-grouprestaurant.com`       | `Xian@123`             |
| Branch Manager (X-02) | `xenial@x-grouprestaurant.com`     | `Xenial@123`           |

_(Full list in `prisma/seed.ts`. Passwords can be pinned via `SEED_*_PASSWORD` env vars.)_

### Database Scripts

| Script                    | Safe on prod? | Purpose                                              |
| ------------------------- | ------------- | ---------------------------------------------------- |
| `npm run seed`            | ❌ Dev only   | **Wipes all data**, then seeds everything (refuses production without `ALLOW_PRODUCTION_SEED=true`) |
| `npm run ensure:executives` | ✅ Yes      | Upserts COO/MD accounts by email, touches nothing else |
| `npm run seed:inventory`  | ✅ Yes        | Idempotent inventory catalog sync (creates missing, re-syncs order) |
| `npm run passwords:rotate`| ✅ Yes        | Re-hashes known seed accounts, revokes their sessions |
| `npm run reports:pdf` | ✅ Yes        | Dry-run: builds yesterday's matrix PDF to `tmp/` (no mail sent) |
| `npm run db:status`       | ✅ Yes        | Shows applied vs pending migrations (read-only)      |
| `npm run db:deploy`       | ✅ Yes        | Applies pending migrations (always run after pull)   |

All scripts share `prisma/seed-utils.ts` (client setup, password resolution, known-account registry).

### Report Mails (scheduled cron removed)

Scheduled booking report mails are **disabled** — the `node-cron` scheduler
(`src/lib/cron.ts`) was removed. No automatic mails are sent.

Manual options still available:

| Command | Job |
| ------- | --- |
| `npm run reports:pdf` | Dry-run: builds yesterday's matrix PDF to `tmp/` (no mail sent) |

Mail stack (kept for manual use): Gmail SMTP singleton (`src/lib/mailer.ts`),
EJS body (`src/templates/booking-report.template.ts`), builders in
`src/lib/report-mailer.ts`. Configure in `.env`: `SMTP_USER` + `SMTP_PASSWORD`
(Gmail **App Password**), `EMAIL_SENDER`, `REPORT_MAIL_TO`.

---

## API Reference

### Base URL

```
http://localhost:5000/api/v1
```

### Standard Response Format

All endpoints return JSON in this shape:

**Success**

```json
{
  "success": true,
  "message": "Human-readable description",
  "data": {}
}
```

**Error**

```json
{
  "success": false,
  "message": "What went wrong",
  "errors": [{ "field": "email", "message": "Invalid email address" }]
}
```

**Paginated list**

```json
{
  "success": true,
  "message": "...",
  "data": {
    "data": [],
    "meta": {
      "page": 1,
      "limit": 10,
      "totalRecords": 120,
      "totalPages": 12,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

---

### Health

| Method | Endpoint         | Auth | Description         |
| ------ | ---------------- | ---- | ------------------- |
| `GET`  | `/api/v1/health` | ❌   | Server health check |

---

### Auth (`/api/v1/auth`)

| Method | Endpoint              | Auth   | Rate Limit | Description                                     |
| ------ | --------------------- | ------ | ---------- | ----------------------------------------------- |
| `POST` | `/auth/login`         | ❌     | 10/15min   | Login with email + password                     |
| `POST` | `/auth/refresh-token` | ❌     | —          | Get a new access token via refresh token cookie |
| `POST` | `/auth/logout`        | ❌     | —          | Clear cookies                                   |
| `GET`  | `/auth/me`            | ✅ All | —          | Get current authenticated user                  |

---

### Users (`/api/v1/users`)

> **Access:** `SUPER_ADMIN`, `ADMIN`

| Method   | Endpoint            | Auth | Description                        |
| -------- | ------------------- | ---- | ---------------------------------- |
| `POST`   | `/users`            | ✅   | Create a new user                  |
| `GET`    | `/users`            | ✅   | List users (paginated, filterable) |
| `GET`    | `/users/:id`        | ✅   | Get user by ID                     |
| `PUT`    | `/users/:id`        | ✅   | Update user details                |
| `PATCH`  | `/users/:id/status` | ✅   | Activate or deactivate user        |
| `DELETE` | `/users/:id`        | ✅   | Soft-delete user                   |

**Query params for `GET /users`:**
`page`, `limit`, `sortBy`, `sortOrder`, `search`, `role`, `isActive`

---

### Branches (`/api/v1/branches`)

| Method   | Endpoint               | Auth      | Description                                  |
| -------- | ---------------------- | --------- | -------------------------------------------- |
| `GET`    | `/branches/active`     | ❌        | List all active branches (for feedback form) |
| `POST`   | `/branches`            | ✅ ADMIN+ | Create branch                                |
| `GET`    | `/branches`            | ✅ ADMIN+ | List branches (paginated, filterable)        |
| `GET`    | `/branches/:id`        | ✅ ADMIN+ | Get branch by ID                             |
| `PUT`    | `/branches/:id`        | ✅ ADMIN+ | Update branch details                        |
| `PATCH`  | `/branches/:id/status` | ✅ ADMIN+ | Activate or deactivate branch                |
| `DELETE` | `/branches/:id`        | ✅ ADMIN+ | Soft-delete branch                           |

**Query params for `GET /branches`:**
`page`, `limit`, `sortBy`, `sortOrder`, `search`, `isActive`

---

### Feedback (`/api/v1/feedbacks`)

| Method | Endpoint         | Auth   | Description                            |
| ------ | ---------------- | ------ | -------------------------------------- |
| `POST` | `/feedbacks`     | ❌     | Submit guest feedback                  |
| `GET`  | `/feedbacks`     | ✅ All | List feedbacks (paginated, filterable) |
| `GET`  | `/feedbacks/:id` | ✅ All | Get feedback by ID                     |

**Query params for `GET /feedbacks`:**
`page`, `limit`, `sortBy`, `sortOrder`, `branchId`, `rating`, `search`, `startDate`, `endDate`

> **Note:** `BRANCH_MANAGER` sees only their own branch's feedbacks automatically.

---

### Dashboard (`/api/v1/dashboard`)

> **Access:** All authenticated roles (BRANCH_MANAGER scoped to own branch)

| Method | Endpoint                       | Auth      | Description                                          |
| ------ | ------------------------------ | --------- | ---------------------------------------------------- |
| `GET`  | `/dashboard/summary`           | ✅ All    | KPI summary (totals, averages, distribution, recent) |
| `GET`  | `/dashboard/recent-feedback`   | ✅ All    | Last 20 feedbacks                                    |
| `GET`  | `/dashboard/branch-ranking`    | ✅ ADMIN+ | All branches ranked by average rating                |
| `GET`  | `/dashboard/negative-feedback` | ✅ All    | Last 50 feedbacks with overall rating ≤ 2 (or 3)     |

---

### Analytics (`/api/v1/analytics`)

> **Access:** All authenticated roles (BRANCH_MANAGER scoped to own branch)

| Method | Endpoint                  | Auth      | Description                                  |
| ------ | ------------------------- | --------- | -------------------------------------------- |
| `GET`  | `/analytics/ratings`      | ✅ All    | Average ratings + distribution per category  |
| `GET`  | `/analytics/branches`     | ✅ ADMIN+ | Per-branch performance comparison            |
| `GET`  | `/analytics/monthly`      | ✅ All    | Monthly trend (avg rating + count per month) |
| `GET`  | `/analytics/satisfaction` | ✅ All    | Customer satisfaction rate + category        |

---

### Reports (`/api/v1/reports`)

> **Access:** All authenticated roles (BRANCH_MANAGER scoped to own branch)

| Method | Endpoint                | Auth   | Description                                         |
| ------ | ----------------------- | ------ | --------------------------------------------------- |
| `GET`  | `/reports/daily`        | ✅ All | Today's summary + all feedbacks                     |
| `GET`  | `/reports/weekly`       | ✅ All | Last 7 days summary + all feedbacks                 |
| `GET`  | `/reports/monthly`      | ✅ All | Current month summary + all feedbacks               |
| `GET`  | `/reports/branch`       | ✅ All | Branch-specific report (BRANCH_MANAGER: own branch) |
| `GET`  | `/reports/export/excel` | ✅ All | Download `.xlsx` file                               |
| `GET`  | `/reports/export/pdf`   | ✅ All | PDF (coming soon)                                   |

**Query params for Excel export:**
`branchId` (ADMIN+ only), `startDate` (YYYY-MM-DD), `endDate` (YYYY-MM-DD)

---

### Settings (`/api/v1/settings`)

| Method | Endpoint    | Auth           | Description                 |
| ------ | ----------- | -------------- | --------------------------- |
| `GET`  | `/settings` | ❌             | Get all system settings     |
| `PUT`  | `/settings` | ✅ SUPER_ADMIN | Update one or more settings |

---

### Document Approval & E-Signature (`/api/v1/documents`, `/api/v1/approvals`)

A dynamic multi-level approval workflow. The creator picks **who** signs and in
**what order**; the backend routes the document, records every decision and
generates the final signed PDF.

**Design principles enforced server-side**

- The user defines the workflow; the system enforces company policy and never
  silently reorders a sequence — violations are reported with the exact position.
- Every document **version** gets its own approval cycle. Previous approvals are
  never reused, and a version cannot be submitted twice.
- A workflow step can be decided **exactly once**: `approvals.workflow_step_id`
  is `UNIQUE` and each step is claimed with a conditional update.
- Signatures are snapshotted with the exact image and SHA-256 used, so a later
  profile change never rewrites a historical approval.

**Approval hierarchy** is derived from the existing `Role` enum — no second org
model to maintain:

| Rank | Role           |
| ---- | -------------- |
| 10   | `BRANCH_MANAGER` |
| 20   | `ADMIN`          |
| 30   | `COO`            |
| 40   | `MD`             |
| 50   | `SUPER_ADMIN`    |

With the default `JUNIOR_TO_SENIOR` policy a sequence must be non-decreasing in
rank. Equal ranks are allowed (with a warning). Set `hierarchyPolicy: "NONE"` to
disable.

#### Documents

| Method | Endpoint                     | Auth              | Description                                    |
| ------ | ---------------------------- | ----------------- | ---------------------------------------------- |
| `POST` | `/documents`                 | write roles       | Create (multipart). `submit=true` also routes  |
| `GET`  | `/documents`                 | all internal      | List; supports `view` buckets + filters        |
| `GET`  | `/documents/summary`         | all internal      | Dashboard counters                             |
| `GET`  | `/documents/types`           | all internal      | Active document types                          |
| `POST` | `/documents/types`           | SUPER_ADMIN       | Create a document type                         |
| `PATCH`| `/documents/types/:id`       | SUPER_ADMIN       | Update a document type                         |
| `DELETE`| `/documents/types/:id`      | SUPER_ADMIN       | Delete (fails if still in use)                 |
| `GET`  | `/documents/policy`          | all internal      | Approval policy                                |
| `PATCH`| `/documents/policy`          | SUPER_ADMIN       | Update approval policy                         |
| `GET`  | `/documents/audit-feed`      | SUPER_ADMIN       | Platform-wide audit log                        |
| `GET`  | `/documents/audit-actions`   | SUPER_ADMIN       | Distinct audit action labels                   |
| `GET`  | `/documents/storage-info`    | all internal      | Active storage provider                        |
| `POST` | `/documents/sla-sweep`       | SUPER_ADMIN       | Send reminders / escalate overdue steps        |
| `GET`  | `/documents/:id`             | authorised        | Detail incl. versions, workflow, capabilities  |
| `PATCH`| `/documents/:id/submit`      | creator           | Start the approval cycle                       |
| `POST` | `/documents/:id/approve`     | active approver   | Approve & sign at a normalised placement       |
| `POST` | `/documents/:id/reject`      | active approver   | Reject — reason required, ends the cycle       |
| `POST` | `/documents/:id/request-changes` | active approver | Return to the creator — reason required      |
| `POST` | `/documents/:id/revisions`   | creator           | Upload a new version (multipart)               |
| `POST` | `/documents/:id/cancel`      | creator / admin   | Cancel — reason required                       |
| `POST` | `/documents/:id/archive`     | creator / SUPER_ADMIN | Archive an approved document               |
| `DELETE`| `/documents/:id`            | creator / SUPER_ADMIN | Soft delete                                |
| `GET`  | `/documents/:id/versions`    | authorised        | Version history                                |
| `GET`  | `/documents/:id/workflow`    | authorised        | Workflow for all versions                      |
| `GET`  | `/documents/:id/audit`       | authorised        | Audit trail for this document                  |
| `GET`  | `/documents/files/:fileId`   | authorised        | Stream a file / redirect to a signed URL       |

`view` buckets: `ALL` · `MINE` · `PENDING_APPROVAL` · `RETURNED` · `REJECTED` ·
`APPROVED` · `ARCHIVED`.

#### Approvals

| Method | Endpoint                       | Auth            | Description                       |
| ------ | ------------------------------ | --------------- | --------------------------------- |
| `GET`  | `/approvals/pending`           | all internal    | Waiting on the signed-in user     |
| `GET`  | `/approvals/history`           | all internal    | Decisions the user has made       |
| `POST` | `/approvals/validate-sequence` | all internal    | Check a sequence against policy   |

#### Signature (self-service)

There is deliberately **no** `/users/:id/signature` route. A user may only ever
manage their own signature, and the id always comes from the session.

| Method | Endpoint                | Auth         | Description                                |
| ------ | ----------------------- | ------------ | ------------------------------------------ |
| `GET`  | `/documents/signature`  | all internal | Read own signature                         |
| `POST` | `/documents/signature`  | all internal | Upload own signature (multipart, ≤ 2 MB)   |
| `DELETE`| `/documents/signature` | all internal | Detach signature (blocked mid-approval)    |

#### Document statuses

`DRAFT` · `SUBMITTED` · `PENDING_APPROVAL` · `IN_REVIEW` ·
`RETURNED_FOR_REVISION` · `REJECTED` · `APPROVED` · `CANCELLED` · `EXPIRED` ·
`ARCHIVED`

#### Supported file types

PDF · DOC · DOCX · XLS · XLSX · JPG · JPEG · PNG · WebP (max 25 MB)

Extension **and** MIME type are both validated, in the multer filter and again in
the controller. Storage ids are backend-generated; a user-supplied filename is
never used as a path.

#### Final PDF

Server-side generation with `pdf-lib`:

- A **PDF** source is copied verbatim — no re-encode, no conversion.
- Any other format is rendered into a certified A4 container page.
- Signature coordinates arrive as percentages of the page box, so the stamp lands
  exactly where it did in the browser.
- The completed document is **locked**; any further change must be a new version.

#### Reminders & escalation

Thresholds live in the policy (`reminderAfterHours`, `escalateAfterHours`) and
the sweep is an explicit `POST /documents/sla-sweep`. Scheduling stays the
caller's job (cron / queue worker) because the deployment topology is unknown.

---

## Authentication

The API supports two token transport methods:

### 1. HttpOnly Cookies (Recommended for browser clients)

Login sets two cookies automatically:

- `accessToken` — used for API requests
- `refreshToken` — used to renew the access token

No manual token handling required. Cookies are `HttpOnly`, `Secure` (in production), and `SameSite=none` (production) / `lax` (development).

### 2. Bearer Token (for non-browser clients / Postman / mobile)

```
Authorization: Bearer <accessToken>
```

Extract the `accessToken` from the login response body and send it in the `Authorization` header.

### Token Flow

```
POST /auth/login
  → accessToken (body + cookie)
  → refreshToken (cookie only)

GET /protected-route
  Authorization: Bearer <accessToken>

POST /auth/refresh-token     ← when access token expires
  Cookie: refreshToken=...
  → new accessToken

POST /auth/logout
  → clears cookies
```

---

## Role Permissions Matrix

> **Rule of thumb:** Only `SUPER_ADMIN` and `ADMIN` can **create, update, or delete** any resource. `BRANCH_MANAGER` has read-only access scoped to their own branch.

| Endpoint Group             | SUPER_ADMIN | ADMIN     | BRANCH_MANAGER |
| -------------------------- | ----------- | --------- | -------------- |
| Auth (login/logout/me)     | ✅          | ✅        | ✅             |
| Users (CRUD)               | ✅          | ✅        | ❌             |
| Branches (CRUD + status)   | ✅          | ✅        | ❌             |
| Branches (active list)     | ✅ public   | ✅ public | ✅ public      |
| Feedback (submit)          | ✅ public   | ✅ public | ✅ public      |
| Feedback (list/view)       | ✅ all      | ✅ all    | ✅ own branch  |
| Dashboard (all metrics)    | ✅          | ✅        | ✅ own branch  |
| Dashboard (branch ranking) | ✅          | ✅        | ❌             |
| Analytics (all)            | ✅          | ✅        | ✅ own branch  |
| Analytics (branch perf)    | ✅          | ✅        | ❌             |
| Reports (all)              | ✅          | ✅        | ✅ own branch  |
| Settings (read)            | ✅ public   | ✅ public | ✅ public      |
| Settings (write)           | ✅          | ❌        | ❌             |

---

## Error Handling

The global error handler maps all errors to clean HTTP responses:

| Error Type               | HTTP   | Example                                    |
| ------------------------ | ------ | ------------------------------------------ |
| Operational (`appError`) | Varies | 404 Not Found, 403 Forbidden               |
| Validation (Zod)         | 422    | Field-level validation errors              |
| Duplicate record (P2002) | 409    | "A record with this email already exists." |
| Not found (P2025)        | 404    | "The requested record was not found."      |
| FK violation (P2003)     | 400    | "A related record does not exist."         |
| Rate limit exceeded      | 429    | Too many requests                          |
| Unhandled server error   | 500    | Generic message in production              |

---

## Performance Features

| Feature                     | Description                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------- |
| **Compound DB indexes**     | `[branchId, submittedAt]` and `[branchId, overallRating]` for common query patterns |
| **Minimal auth DB select**  | Only 6 fields fetched per authenticated request (not `SELECT *`)                    |
| **Raw SQL aggregation**     | Monthly trends use `GROUP BY DATE_FORMAT` — no in-memory aggregation                |
| **Parallel DB queries**     | Dashboard `Promise.all()` for concurrent aggregations                               |
| **Parallel bcrypt hashing** | Password operations use `Promise.all()` where possible                              |
| **Pagination limits**       | `MAX_LIMIT=100`, `MAX_PAGE=1000` hard caps prevent abuse                            |
| **Response compression**    | `gzip` compression via `compression` middleware                                     |
| **Slow query logging**      | Queries ≥500ms logged in development mode                                           |

---

## Security

| Feature          | Implementation                                          |
| ---------------- | ------------------------------------------------------- |
| Security headers | `helmet()` — CSP, HSTS, X-Content-Type-Options, etc.    |
| Rate limiting    | Global: 500/15min; Auth endpoints: 10/15min             |
| Password hashing | `bcrypt` with configurable cost factor (default: 12)    |
| JWT storage      | HttpOnly cookies prevent XSS token theft                |
| Soft deletes     | Users and branches are never hard-deleted               |
| Input validation | Zod schemas on all request inputs (body, query, params) |
| CORS             | Restricted to configured `APP_URL` origin               |

---

## Scripts

| Script        | Command                       | Description                                              |
| ------------- | ----------------------------- | -------------------------------------------------------- |
| Dev server    | `npm run dev`                 | Start with hot-reload via `tsx watch`                    |
| Build         | `npm run build`               | Compile TypeScript to `dist/`                            |
| Start         | `npm run start`               | Run compiled production build                            |
| Seed (dev)    | `npm run seed`                | ⚠️ Wipes + seeds database (dev only)                    |
| Documents     | `npm run seed:documents`      | Non-destructive: types, policy, signatures, samples    |
| Smoke test    | `npx tsx scripts/smoke-document-module.ts` | Live end-to-end workflow test (server must be running) |
| Storage check | `npx tsx scripts/diagnose-storage.ts`     | Verify Cloudinary upload + signed download      |
| Module report | `npx tsx scripts/document-module-report.ts` | Row counts + data-integrity report (read-only)  |
| Executives    | `npm run ensure:executives`   | Upsert COO/MD accounts (prod-safe)                       |
| Inventory     | `npm run seed:inventory`      | Idempotent catalog sync (prod-safe)                      |
| Rotate pw     | `npm run passwords:rotate`    | Re-hash seed accounts, revoke sessions                   |
| DB status     | `npm run db:status`           | Show pending migrations (read-only)                      |
| DB deploy     | `npm run db:deploy`           | Apply pending migrations                                 |
| Typecheck     | `npm run typecheck`           | TypeScript type check (`tsc --noEmit`)                   |
| Prisma Studio | `npx prisma studio`           | Visual DB browser at `localhost:5555`                    |
| DB push       | `npx prisma db push`  | Sync schema to DB (dev, no migrations)        |
| Generate      | `npx prisma generate` | Regenerate Prisma client after schema changes |
