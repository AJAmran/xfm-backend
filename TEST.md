# X-Group Feedback API — Postman Test Guide

**Base URL:** `http://localhost:5000/api/v1`

**After running `npm run seed`, use these test credentials:**

| Role | Email | Password |
|------|-------|----------|
| SUPER_ADMIN | superadmin@x-grouprestaurant.com | SuperAdmin@123 |
| ADMIN | admin@x-grouprestaurant.com | Admin@123 |
| BRANCH_MANAGER | xian@x-grouprestaurant.com | Xian@123 |

---

## 1. Health & Root

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | Welcome message | No |
| GET | `/api/v1/health` | Health check (includes DB status) | No |

**GET /api/v1/health — Response:**
```json
{
  "success": true,
  "status": "ok",
  "uptime": 123,
  "timestamp": "2026-07-12T...",
  "version": "v1",
  "database": "healthy"
}
```

---

## 2. Authentication

After login, copy the `accessToken` from the response and add `Authorization: Bearer <token>` to protected endpoints.

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| POST | `/api/v1/auth/login` | No | `{ "email": "...", "password": "..." }` |
| POST | `/api/v1/auth/refresh-token` | Cookie | _(uses HttpOnly cookie)_ |
| POST | `/api/v1/auth/logout` | Cookie | _(clears cookies)_ |
| GET | `/api/v1/auth/me` | Bearer | — |

### Login Examples

**SUPER_ADMIN login:**
```json
{
  "email": "superadmin@x-grouprestaurant.com",
  "password": "SuperAdmin@123"
}
```

**ADMIN login:**
```json
{
  "email": "admin@x-grouprestaurant.com",
  "password": "Admin@123"
}
```

**BRANCH_MANAGER login:**
```json
{
  "email": "xian@x-grouprestaurant.com",
  "password": "Xian@123"
}
```

### Error Cases to Test

| Test | Payload | Expected Status |
|------|---------|-----------------|
| Wrong password | `{ "email": "xian@x-grouprestaurant.com", "password": "WrongPassword" }` | **401** |
| Email not found | `{ "email": "noone@test.com", "password": "Admin@123" }` | **404** |
| Invalid email + short password | `{ "email": "bad", "password": "short" }` | **422** |
| Empty body | `{}` | **422** |
| No auth header | _(GET /auth/me with no Bearer)_ | **401** |
| Invalid token | _(GET /auth/me with `Bearer invalid.token.here`)_ | **401** |

---

## 3. Branches

### Public Endpoint

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/api/v1/branches/active` | No |

Returns all active branches (id, name, code, address, phone).

### Protected Endpoints (SUPER_ADMIN or ADMIN)

| Method | Endpoint | Body/Query |
|--------|----------|------------|
| POST | `/api/v1/branches/` | `{ "name", "code", "address", "latitude", "longitude", "phone?": "..." }` |
| GET | `/api/v1/branches/?page=1&limit=10` | Query: `page`, `limit`, `sortBy`, `sortOrder`, `search`, `isActive` |
| GET | `/api/v1/branches/:id` | — |
| PUT | `/api/v1/branches/:id` | `{ "name"?, "code"?, "address"?, "phone"?, "latitude"?, "longitude"?, "isActive"? }` |
| PATCH | `/api/v1/branches/:id/status` | `{ "isActive": boolean }` |
| DELETE | `/api/v1/branches/:id` | _(soft delete)_ |

### Create Branch Example

```json
{
  "name": "Test Branch",
  "code": "X-TEST-001",
  "address": "123 Test Road, Dhaka",
  "phone": "01700000000",
  "latitude": 23.75,
  "longitude": 90.38
}
```

**Expected: 201 Created**

### Error Cases to Test

| Test | Expected Status |
|------|-----------------|
| POST duplicate code (use existing "X-01") | **409** |
| GET /branches/99999 | **404** |
| BRANCH_MANAGER creates a branch | **403** |

---

## 4. Feedback (Public Submission)

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| POST | `/api/v1/feedbacks/` | No | Feedback data |
| GET | `/api/v1/feedbacks/` | Bearer | Query params |
| GET | `/api/v1/feedbacks/:id` | Bearer | — |

### Full Feedback Submission Example

```json
{
  "branchId": 1,
  "guestName": "John Doe",
  "contact": "01711111111",
  "foodRating": 5,
  "serviceRating": 4,
  "environmentRating": 5,
  "eventRating": 4,
  "overallRating": 5,
  "heardAbout": "SOCIAL_MEDIA",
  "ageGroup": "AGE_18_30",
  "opinion": "Amazing experience!"
}
```

**Expected: 201 Created**

### Minimal Feedback

```json
{
  "branchId": 2,
  "guestName": "Jane Doe",
  "foodRating": 4,
  "serviceRating": 4,
  "environmentRating": 4,
  "eventRating": 3,
  "overallRating": 4
}
```

### Error Cases to Test

| Test | Payload | Expected Status |
|------|---------|-----------------|
| Invalid branchId (99999) | valid body with `branchId: 99999` | **404** |
| Rating below min (1) | `"foodRating": 1` with valid rest | **422** |
| Invalid enum value | `"heardAbout": "INVALID_VALUE"` | **422** |

### List Feedbacks (Authenticated)

**Query parameters:** `page`, `limit`, `branchId`, `rating`, `startDate`, `endDate`, `search`

| Query | Example | Description |
|-------|---------|-------------|
| page | `?page=1&limit=10` | Pagination |
| branchId | `?branchId=1` | Filter by branch |
| rating | `?rating=5` | Filter by overall rating |
| startDate / endDate | `?startDate=2026-01-01&endDate=2026-07-11` | Date range |
| search | `?search=Rafiq` | Search guest name or contact |

**Note:** BRANCH_MANAGER can only see their own branch's feedback.

---

## 5. Users (SUPER_ADMIN or ADMIN)

| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/v1/users/` | `{ "name", "email", "password", "role", "branchId"? }` |
| GET | `/api/v1/users/` | Query: `page`, `limit`, `sortBy`, `sortOrder`, `search`, `role`, `isActive` |
| GET | `/api/v1/users/:id` | — |
| PUT | `/api/v1/users/:id` | `{ "name"?, "email"?, "password"?, "role"?, "branchId"?, "isActive"? }` |
| PATCH | `/api/v1/users/:id/status` | `{ "isActive": boolean }` |
| DELETE | `/api/v1/users/:id` | _(soft delete)_ |

### Create User Example

```json
{
  "name": "Test Manager",
  "email": "testmanager@x-grouprestaurant.com",
  "password": "Test@1234",
  "role": "BRANCH_MANAGER",
  "branchId": 1
}
```

**Expected: 201 Created**

### Role Enum Values
`SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`

### Error Cases to Test

| Test | Expected Status |
|------|-----------------|
| POST duplicate email | **409** |
| DELETE /users/99999 | **404** |
| BRANCH_MANAGER lists users | **403** |

---

## 6. Dashboard (SUPER_ADMIN, ADMIN, BRANCH_MANAGER)

| Method | Endpoint | Auth | Notes |
|--------|----------|------|-------|
| GET | `/api/v1/dashboard/summary` | All roles | Summary stats (filtered by branch for BM) |
| GET | `/api/v1/dashboard/recent-feedback` | All roles | Last 20 feedbacks |
| GET | `/api/v1/dashboard/branch-ranking` | SUPER_ADMIN, ADMIN | Branch performance ranking |
| GET | `/api/v1/dashboard/negative-feedback` | All roles | Feedbacks with rating ≤ 2 |

### Response Structure (Summary)
```json
{
  "success": true,
  "message": "Dashboard summary retrieved successfully",
  "data": {
    "totalFeedbacks": 120,
    "averageRatings": { "overallRating": 4.1, "foodRating": 4.2, ... },
    "negativeFeedbackCount": 3,
    "ratingDistribution": [
      { "rating": 3, "count": 25 },
      { "rating": 4, "count": 50 },
      { "rating": 5, "count": 45 }
    ],
    "recentFeedbacks": [...]
  }
}
```

---

## 7. Analytics (SUPER_ADMIN, ADMIN, BRANCH_MANAGER)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/analytics/ratings` | All roles | Average ratings + distribution |
| GET | `/api/v1/analytics/branches` | SUPER_ADMIN, ADMIN | Per-branch performance |
| GET | `/api/v1/analytics/monthly` | All roles | Monthly feedback trends |
| GET | `/api/v1/analytics/satisfaction` | All roles | Overall satisfaction rate |

### Response Structure (Ratings)
```json
{
  "success": true,
  "message": "Rating analytics retrieved successfully",
  "data": {
    "averages": { "overallRating": 4.1, "foodRating": 4.2, ... },
    "totalFeedbacks": 120,
    "distribution": [
      { "rating": 3, "count": 25, "percentage": 21 },
      { "rating": 4, "count": 50, "percentage": 42 },
      { "rating": 5, "count": 45, "percentage": 38 }
    ]
  }
}
```

---

## 8. Reports (SUPER_ADMIN, ADMIN, BRANCH_MANAGER)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/reports/daily` | Today's feedback report |
| GET | `/api/v1/reports/weekly` | Last 7 days report |
| GET | `/api/v1/reports/monthly` | Current month report |
| GET | `/api/v1/reports/branch?branchId=1` | Specific branch report |
| GET | `/api/v1/reports/export/excel?startDate=...&endDate=...` | Download Excel file |
| GET | `/api/v1/reports/export/pdf` | _(future)_ |

### Report Branch Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| branchId | string | For ADMIN/SUPER_ADMIN | Branch ID to filter by |
| startDate | string | Optional (Excel) | ISO date, e.g. `2026-01-01` |
| endDate | string | Optional (Excel) | ISO date, e.g. `2026-07-11` |

**Note:** BRANCH_MANAGER reports are auto-scoped to their own branch.

### Excel Export
- **Content-Type:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Save response as `feedbacks.xlsx` and open in Excel

---

## 9. Settings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/settings/` | No | Public settings (company info, form active flag) |
| PUT | `/api/v1/settings/` | SUPER_ADMIN | Update settings via key-value pairs |

### Update Settings Example
```json
{
  "company_name": "X-Group Restaurants Ltd.",
  "contact_phone": "01900000000"
}
```

**Expected: 200 OK**

### Error Cases to Test

| Test | Expected Status |
|------|-----------------|
| ADMIN updates settings | **403** |
| BRANCH_MANAGER updates settings | **403** |

---

## Quick Test Flow (Smoke Test)

1. **GET /api/v1/health** — confirm server and DB are up
2. **POST /api/v1/auth/login** (SUPER_ADMIN) — save `accessToken`
3. **GET /api/v1/branches/active** — confirm public branch list works
4. **POST /api/v1/feedbacks/** — submit sample feedback
5. **GET /api/v1/dashboard/summary** (with Bearer token) — confirm dashboard loads
6. **GET /api/v1/reports/daily** (with Bearer token) — confirm reports work
7. **GET /api/v1/settings** — confirm public settings load
