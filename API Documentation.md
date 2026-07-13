# X-Group Feedback Management System (XFMS) v1.0

## 1. Overview

The X-Group Feedback Management System (XFMS) exposes a RESTful API that enables communication between the frontend (Next.js) and the backend (Express.js). All data is exchanged in JSON format. The API follows REST principles and uses JWT-based authentication for protected endpoints.

## 2. API Information

| Item | Value |
|---|---|
| Architecture | REST API |
| Protocol | HTTP / HTTPS |
| Data Format | JSON |
| Authentication | JWT Access Token + Refresh Token |
| API Version | v1 |
| Base URL | `/api/v1` |

## 3. Authentication

The system uses **JWT Authentication** with access and refresh tokens.

### Access Token
- Short-lived (1 day)
- Sent via `Authorization: Bearer <token>` header **or** `accessToken` HttpOnly cookie
- Used to access protected APIs

### Refresh Token
- Long-lived (7 days)
- Stored in `refreshToken` HttpOnly cookie (automatically sent by browser)
- Used to generate a new access token via `/api/v1/auth/refresh-token`

### Auth Guard Middleware
Protected endpoints use `authGuard(...roles)` which:
- Extracts JWT from `req.cookies.accessToken` or `Authorization: Bearer <token>`
- Verifies JWT and checks user exists, is not soft-deleted, is active (`isActive: true`), and has required role
- Attaches `req.user = { id, email, name, role, branchId }` on success

### Error Responses
| Status | Message |
|---|---|
| 401 | `You are not authorized to access this resource` (no token) |
| 401 | `Invalid or expired access token` (JWT verification fails) |
| 401 | `User not found or has been deleted` |
| 403 | `Your account has been suspended` (`isActive === false`) |
| 403 | `Forbidden: You do not have permission to perform this action` (role mismatch) |

## 4. Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully.",
  "data": {}
}
```

### Error Response
```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": [{ "field": "fieldName", "message": "Error description" }]
}
```

### Global Error Mapping
| Condition | Status | Message |
|---|---|---|
| Custom `appError` | As set | Custom message |
| Prisma P2002 (unique violation) | 409 | `A record with this {field} already exists.` |
| Prisma P2025 (not found) | 404 | `The requested record was not found.` |
| Prisma P2003 (FK violation) | 400 | `Operation failed: a related record does not exist.` |
| Prisma validation error | 400 | `Invalid database query.` |
| Unhandled error (production) | 500 | `An unexpected error occurred.` |

## 5. Pagination, Filtering & Sorting

All list endpoints support the following query parameters and return a standardized paginated response.

### Query Parameters
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | string (integer) | `"1"` | Page number (clamped 1–1000) |
| `limit` | string (integer) | `"10"` | Items per page (clamped 1–100) |
| `sortBy` | string | Varies | Field to sort by |
| `sortOrder` | `"asc"` \| `"desc"` | `"desc"` | Sort direction |

### Paginated Response Structure
```json
{
  "success": true,
  "message": "...",
  "data": {
    "data": [ ... ],
    "meta": {
      "page": 1,
      "limit": 10,
      "totalRecords": 45,
      "totalPages": 5,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

### Additional Filters (per module)
Additional query parameters vary by endpoint — detailed in each section below.

## 6. Authentication APIs

Base path: `/api/v1/auth`

---

### Login

**POST** `/api/v1/auth/login`

Rate limited: 50 requests per 15 minutes (`authLimiter`)

**Request Body**
```json
{
  "email": "admin@example.com",
  "password": "password123"
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string (email) | Yes | User email |
| `password` | string (min 8) | Yes | User password |

**Response (200)** — Sets `accessToken` (1 day) and `refreshToken` (7 days) as HttpOnly cookies
```json
{
  "success": true,
  "message": "User logged in successfully",
  "data": {
    "accessToken": "jwt...",
    "user": {
      "id": 1,
      "name": "Admin",
      "email": "admin@example.com",
      "role": "SUPER_ADMIN",
      "branchId": null,
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

**Errors:** 404 (`No account found matching that email address`), 403 (`Your account has been suspended`), 401 (`Incorrect password`), 422

---

### Refresh Token

**POST** `/api/v1/auth/refresh-token`

Requires `refreshToken` HttpOnly cookie.

**Response (200)** — Renews `accessToken` cookie
```json
{
  "success": true,
  "message": "Access token renewed successfully",
  "data": {
    "accessToken": "jwt..."
  }
}
```

**Errors:** 401 (`Refresh token not found`), 401 (`Session expired: Refresh token validation failure`), 403 (`Invalid security context for session rotation`)

---

### Logout

**POST** `/api/v1/auth/logout`

**Response (200)** — Clears `accessToken` and `refreshToken` cookies
```json
{
  "success": true,
  "message": "User logged out successfully",
  "data": {}
}
```

---

### Current User

**GET** `/api/v1/auth/me`

**Auth:** `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`

**Response (200)**
```json
{
  "success": true,
  "message": "Current user retrieved successfully",
  "data": {
    "id": 1,
    "name": "Admin",
    "email": "admin@example.com",
    "role": "SUPER_ADMIN",
    "branchId": null,
    "isActive": true,
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

---

## 7. Branch APIs

Base path: `/api/v1/branches`

All endpoints except `GET /active` require `SUPER_ADMIN` or `ADMIN`.

---

### Get Active Branches (Public)

**GET** `/api/v1/branches/active`

**Auth:** None (public)

**Response (200)**
```json
{
  "success": true,
  "message": "Active branches retrieved successfully",
  "data": [
    { "id": 1, "name": "Downtown", "code": "DT01", "address": "123 Main St", "phone": "555-0100" }
  ]
}
```

---

### Create Branch

**POST** `/api/v1/branches`

**Auth:** `SUPER_ADMIN`, `ADMIN`

**Request Body**
```json
{
  "name": "Uptown",
  "code": "UP01",
  "address": "456 Oak Ave",
  "phone": "555-0101",
  "latitude": 40.7128,
  "longitude": -74.006
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string (min 1) | Yes | Branch name |
| `code` | string (min 1, unique) | Yes | Branch short code |
| `address` | string (min 1) | Yes | Branch address |
| `phone` | string | No | Contact phone |
| `latitude` | number (-90 to 90) | Yes | Latitude |
| `longitude` | number (-180 to 180) | Yes | Longitude |

**Response (201)**
```json
{
  "success": true,
  "message": "Branch created successfully",
  "data": {
    "id": 2,
    "name": "Uptown",
    "code": "UP01",
    "address": "456 Oak Ave",
    "phone": null,
    "latitude": 40.7128,
    "longitude": -74.006,
    "isActive": true,
    "isDeleted": false,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Errors:** 409 (`A branch with this code already exists`), 422

---

### List Branches

**GET** `/api/v1/branches`

**Auth:** `SUPER_ADMIN`, `ADMIN`

**Query Parameters**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | string | `"1"` | Page number |
| `limit` | string | `"10"` | Items per page |
| `sortBy` | string | `"createdAt"` | Sort field |
| `sortOrder` | `"asc"` \| `"desc"` | `"desc"` | Sort direction |
| `search` | string | — | Search `name` and `code` |
| `isActive` | string (`"true"` \| `"false"`) | — | Filter by active status |

**Response (200)** — Paginated list of branch objects (same shape as create response)

---

### Get Branch

**GET** `/api/v1/branches/:id`

**Auth:** `SUPER_ADMIN`, `ADMIN`

**Params:** `id` — positive integer

**Response (200)** — Single branch object

**Errors:** 404 (`Branch not found`)

---

### Update Branch

**PUT** `/api/v1/branches/:id`

**Auth:** `SUPER_ADMIN`, `ADMIN`

**Request Body** (all optional)
| Field | Type | Description |
|---|---|---|
| `name` | string (min 1) | Branch name |
| `code` | string (min 1, unique) | Branch code |
| `address` | string (min 1) | Branch address |
| `phone` | string \| null | Contact phone |
| `latitude` | number (-90..90) | Latitude |
| `longitude` | number (-180..180) | Longitude |
| `isActive` | boolean | Active status |

**Response (200)** — Updated branch object

**Errors:** 404, 409 (duplicate code)

---

### Update Branch Status

**PATCH** `/api/v1/branches/:id/status`

**Auth:** `SUPER_ADMIN`, `ADMIN`

**Request Body**
| Field | Type | Required | Description |
|---|---|---|---|
| `isActive` | boolean | Yes | Active status |

**Response (200)** — Updated branch object

**Errors:** 404

---

### Delete Branch (Soft Delete)

**DELETE** `/api/v1/branches/:id`

**Auth:** `SUPER_ADMIN`, `ADMIN`

**Response (200)**
```json
{
  "success": true,
  "message": "Branch deleted successfully",
  "data": {}
}
```

**Errors:** 404

---

## 8. User Management APIs

Base path: `/api/v1/users`

All endpoints require `SUPER_ADMIN` or `ADMIN`.

---

### Create User

**POST** `/api/v1/users`

**Request Body**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "password123",
  "role": "BRANCH_MANAGER",
  "branchId": 1
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string (min 1) | Yes | Full name |
| `email` | string (email, unique) | Yes | Email address |
| `password` | string (min 8) | Yes | Password |
| `role` | enum | Yes | `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER` |
| `branchId` | number (int) | For BRANCH_MANAGER | Assigned branch ID |

**Response (201)**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": 3,
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "BRANCH_MANAGER",
    "branchId": 1,
    "isActive": true,
    "isDeleted": false,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Errors:** 409 (`A user with this email already exists`), 422

---

### List Users

**GET** `/api/v1/users`

**Query Parameters**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | string | `"1"` | Page number |
| `limit` | string | `"10"` | Items per page |
| `sortBy` | string | `"createdAt"` | Sort field |
| `sortOrder` | `"asc"` \| `"desc"` | `"desc"` | Sort direction |
| `search` | string | — | Search `name` and `email` |
| `role` | enum | — | Filter by role |
| `isActive` | string (`"true"` \| `"false"`) | — | Filter by active status |

**Response (200)** — Paginated list of user objects (without password field)

---

### Get User

**GET** `/api/v1/users/:id`

**Response (200)** — Single user object without password

**Errors:** 404 (`User not found`)

---

### Update User

**PUT** `/api/v1/users/:id`

**Request Body** (all optional)
| Field | Type | Description |
|---|---|---|
| `name` | string (min 1) | Full name |
| `email` | string (email) | Email address |
| `password` | string (min 8) | Password |
| `role` | enum | `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER` |
| `branchId` | number \| null | Assigned branch ID |
| `isActive` | boolean | Active status |

**Response (200)** — Updated user object without password

**Errors:** 404, 409 (duplicate email)

---

### Update User Status

**PATCH** `/api/v1/users/:id/status`

**Request Body**
| Field | Type | Required | Description |
|---|---|---|---|
| `isActive` | boolean | Yes | Active status |

**Response (200)** — Updated user object

**Errors:** 404

---

### Delete User (Soft Delete)

**DELETE** `/api/v1/users/:id`

**Response (200)**
```json
{
  "success": true,
  "message": "User deleted successfully",
  "data": {}
}
```

**Errors:** 404

---

## 9. Guest Feedback APIs

Base path: `/api/v1/feedbacks`

---

### Submit Feedback (Public)

**POST** `/api/v1/feedbacks`

**Auth:** None (public)

Optimized for speed — relies on DB-level foreign key constraints rather than pre-validation of branch existence.

**Request Body**
```json
{
  "branchId": 1,
  "guestName": "Alex",
  "contact": "alex@example.com",
  "foodRating": 4,
  "serviceRating": 5,
  "environmentRating": 4,
  "eventRating": null,
  "overallRating": 4,
  "heardAbout": "SOCIAL_MEDIA",
  "ageGroup": "AGE_18_30",
  "opinion": "Great food!"
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `branchId` | number (int, positive) | Yes | Branch ID |
| `guestName` | string (min 1) | Yes | Guest name |
| `contact` | string | Yes | Contact (phone/email) |
| `foodRating` | number (int, 1–5) | No | Food rating |
| `serviceRating` | number (int, 1–5) | No | Service rating |
| `environmentRating` | number (int, 1–5) | No | Environment rating |
| `eventRating` | number (int, 1–5) | No | Event rating |
| `overallRating` | number (int, 1–5) | No | Overall rating |
| `heardAbout` | enum | No | `SOCIAL_MEDIA`, `FRIENDS_AND_FAMILY`, `VISITED_BEFORE` |
| `ageGroup` | enum | No | `BELOW_18`, `AGE_18_30`, `AGE_31_50`, `AGE_51_PLUS` |
| `opinion` | string | No | Additional comments |

**Response (201)**
```json
{
  "success": true,
  "message": "Feedback submitted successfully",
  "data": {
    "id": 42,
    "branchId": 1,
    "guestName": "Alex",
    "contact": "alex@example.com",
    "foodRating": 4,
    "serviceRating": 5,
    "environmentRating": 4,
    "eventRating": null,
    "overallRating": 4,
    "heardAbout": "SOCIAL_MEDIA",
    "ageGroup": "AGE_18_30",
    "opinion": "Great food!",
    "submittedAt": "2026-07-13T10:30:00.000Z"
  }
}
```

**Errors:** 400 (`Operation failed: a related record does not exist.` — invalid branchId), 422

---

### List Feedback

**GET** `/api/v1/feedbacks`

**Auth:** `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`

> **Branch Manager Scope:** Automatically restricted to the manager's own branch. The `branchId` query parameter is ignored for `BRANCH_MANAGER` role.

**Query Parameters**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | string | `"1"` | Page number |
| `limit` | string | `"10"` | Items per page |
| `sortBy` | string | `"submittedAt"` | Sort field |
| `sortOrder` | `"asc"` \| `"desc"` | `"desc"` | Sort direction |
| `branchId` | string | — | Filter by branch (ignored for BRANCH_MANAGER) |
| `rating` | string (number) | — | Filter by `overallRating` |
| `startDate` | string (ISO-8601) | — | Start date filter |
| `endDate` | string (ISO-8601) | — | End date filter |
| `search` | string | — | Search `guestName` and `contact` |

**Response (200)**
```json
{
  "success": true,
  "message": "Feedbacks retrieved successfully",
  "data": {
    "data": [
      {
        "id": 42,
        "branchId": 1,
        "guestName": "Alex",
        "contact": "alex@example.com",
        "foodRating": 4,
        "serviceRating": 5,
        "environmentRating": null,
        "eventRating": null,
        "overallRating": 4,
        "heardAbout": "SOCIAL_MEDIA",
        "ageGroup": "AGE_18_30",
        "opinion": "Great food!",
        "submittedAt": "2026-07-13T10:30:00.000Z",
        "branch": { "name": "Downtown", "code": "DT01" }
      }
    ],
    "meta": { "page": 1, "limit": 10, "totalRecords": 150, "totalPages": 15, "hasNextPage": true, "hasPreviousPage": false }
  }
}
```

---

### Get Feedback Details

**GET** `/api/v1/feedbacks/:id`

**Auth:** `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`

**Response (200)** — Single feedback object with nested `branch: { name, code }`

**Errors:** 404 (`Feedback not found`)

---

## 10. Dashboard APIs

Base path: `/api/v1/dashboard`

All endpoints require `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER` (except `branch-ranking` which requires `SUPER_ADMIN` or `ADMIN` only).

> **Branch Manager Scope:** Automatically restricted to the manager's own branch for all applicable endpoints.

**Common Query Parameters** (all dashboard endpoints)
| Param | Type | Required | Description |
|---|---|---|---|
| `startDate` | string (ISO-8601) | No | Start date filter |
| `endDate` | string (ISO-8601) | No | End date filter |

---

### Dashboard Summary

**GET** `/api/v1/dashboard/summary`

**Response (200)**
```json
{
  "success": true,
  "message": "Dashboard summary retrieved successfully",
  "data": {
    "totalFeedbacks": 250,
    "averageRatings": {
      "overallRating": 4.2,
      "foodRating": 4.1,
      "serviceRating": 4.3,
      "environmentRating": 4.0,
      "eventRating": null
    },
    "negativeFeedbackCount": 15,
    "ratingDistribution": [
      { "rating": 1, "count": 5 },
      { "rating": 2, "count": 10 },
      { "rating": 3, "count": 30 },
      { "rating": 4, "count": 80 },
      { "rating": 5, "count": 125 }
    ],
    "recentFeedbacks": [
      {
        "id": 42,
        "guestName": "Alex",
        "overallRating": 5,
        "submittedAt": "2026-07-13T10:30:00.000Z",
        "opinion": "Excellent!",
        "branch": { "name": "Downtown", "code": "DT01" }
      }
    ]
  }
}
```

---

### Recent Feedback

**GET** `/api/v1/dashboard/recent-feedback`

**Response (200)** — Up to 20 recent feedbacks
```json
{
  "success": true,
  "message": "Recent feedback retrieved successfully",
  "data": [
    {
      "id": 42,
      "guestName": "Alex",
      "contact": "alex@example.com",
      "overallRating": 4,
      "foodRating": 4,
      "serviceRating": 5,
      "environmentRating": null,
      "eventRating": null,
      "opinion": "Great!",
      "submittedAt": "...",
      "branch": { "name": "Downtown", "code": "DT01" }
    }
  ]
}
```

---

### Branch Ranking

**GET** `/api/v1/dashboard/branch-ranking`

**Auth:** `SUPER_ADMIN`, `ADMIN` (only)

**Response (200)**
```json
{
  "success": true,
  "message": "Branch ranking retrieved successfully",
  "data": [
    {
      "branchId": 1,
      "branch": { "name": "Downtown", "code": "DT01" },
      "totalFeedbacks": 120,
      "averageRatings": {
        "overallRating": 4.5,
        "foodRating": 4.4,
        "serviceRating": 4.6,
        "environmentRating": 4.3,
        "eventRating": null
      }
    }
  ]
}
```

---

### Negative Feedback

**GET** `/api/v1/dashboard/negative-feedback`

**Response (200)** — Up to 50 feedbacks with `overallRating <= 2`
```json
{
  "success": true,
  "message": "Negative feedback retrieved successfully",
  "data": [
    {
      "id": 10,
      "guestName": "Sam",
      "contact": "sam@x.com",
      "overallRating": 1,
      "opinion": "Bad service",
      "submittedAt": "...",
      "branch": { "name": "Downtown", "code": "DT01" }
    }
  ]
}
```

---

## 11. Analytics APIs

Base path: `/api/v1/analytics`

All endpoints require `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER` (except `branches` which requires `SUPER_ADMIN` or `ADMIN` only).

> **Branch Manager Scope:** Automatically restricted to the manager's own branch (except `branches`).

**Common Query Parameters** (all analytics endpoints)
| Param | Type | Required | Description |
|---|---|---|---|
| `startDate` | string (ISO-8601) | No | Start date filter |
| `endDate` | string (ISO-8601) | No | End date filter |

---

### Rating Analytics

**GET** `/api/v1/analytics/ratings`

**Response (200)**
```json
{
  "success": true,
  "message": "Rating analytics retrieved successfully",
  "data": {
    "averages": {
      "overallRating": 4.2,
      "foodRating": 4.1,
      "serviceRating": 4.3,
      "environmentRating": 4.0,
      "eventRating": null
    },
    "totalFeedbacks": 250,
    "distribution": [
      { "rating": 1, "count": 5, "percentage": 2 },
      { "rating": 2, "count": 10, "percentage": 4 },
      { "rating": 3, "count": 30, "percentage": 12 },
      { "rating": 4, "count": 80, "percentage": 32 },
      { "rating": 5, "count": 125, "percentage": 50 }
    ]
  }
}
```

---

### Branch Performance

**GET** `/api/v1/analytics/branches`

**Auth:** `SUPER_ADMIN`, `ADMIN` (only)

**Response (200)**
```json
{
  "success": true,
  "message": "Branch performance retrieved successfully",
  "data": [
    {
      "id": 1,
      "name": "Downtown",
      "code": "DT01",
      "isActive": true,
      "totalFeedbacks": 120,
      "averageRatings": {
        "overallRating": 4.5,
        "foodRating": 4.4,
        "serviceRating": 4.6,
        "environmentRating": 4.3,
        "eventRating": null
      }
    }
  ]
}
```

---

### Monthly Trends

**GET** `/api/v1/analytics/monthly`

**Response (200)**
```json
{
  "success": true,
  "message": "Monthly trends retrieved successfully",
  "data": [
    { "month": "2026-01", "averageRating": 4.3, "totalFeedbacks": 45 },
    { "month": "2026-02", "averageRating": 4.1, "totalFeedbacks": 52 }
  ]
}
```

---

### Customer Satisfaction

**GET** `/api/v1/analytics/satisfaction`

**Response (200)**
```json
{
  "success": true,
  "message": "Customer satisfaction retrieved successfully",
  "data": {
    "satisfactionRate": 85,
    "totalFeedbacks": 250,
    "averageRating": 4.2,
    "negativeFeedbackCount": 15,
    "category": "Excellent"
  }
}
```

Category logic: `>= 80` = "Excellent", `>= 60` = "Good", else "Needs Improvement".

---

## 12. Reports APIs

Base path: `/api/v1/reports`

All endpoints require `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER`.

> **Branch Manager Scope:** Automatically restricted to the manager's own branch.

**Common Query Parameters**
| Param | Type | Required | Description |
|---|---|---|---|
| `branchId` | string | No | Branch filter (ignored for BRANCH_MANAGER) |
| `startDate` | string (ISO-8601) | No | Start date filter |
| `endDate` | string (ISO-8601) | No | End date filter |

---

### Daily Report

**GET** `/api/v1/reports/daily`

**Response (200)**
```json
{
  "success": true,
  "message": "Daily report retrieved successfully",
  "data": {
    "period": "daily",
    "date": "2026-07-13",
    "summary": { "total": 25, "averageRating": 4.2, "negativeCount": 2 },
    "feedbacks": [ { "id": 1, "guestName": "...", "overallRating": 4, "branch": { "name": "Downtown", "code": "DT01" } } ]
  }
}
```

---

### Weekly Report

**GET** `/api/v1/reports/weekly`

**Response (200)**
```json
{
  "success": true,
  "message": "Weekly report retrieved successfully",
  "data": {
    "period": "weekly",
    "start": "2026-07-06",
    "end": "2026-07-13",
    "summary": { "total": 150, "averageRating": 4.1, "negativeCount": 10 },
    "feedbacks": [ ... ]
  }
}
```

---

### Monthly Report

**GET** `/api/v1/reports/monthly`

**Response (200)**
```json
{
  "success": true,
  "message": "Monthly report retrieved successfully",
  "data": {
    "period": "monthly",
    "month": "2026-07",
    "summary": { "total": 450, "averageRating": 4.3, "negativeCount": 30 },
    "feedbacks": [ ... ]
  }
}
```

---

### Branch Report

**GET** `/api/v1/reports/branch`

**Auth:** `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`

For `SUPER_ADMIN`/`ADMIN`: `branchId` query parameter is required. For `BRANCH_MANAGER`: uses their own branchId.

**Response (200)**
```json
{
  "success": true,
  "message": "Branch report retrieved successfully",
  "data": {
    "branch": { "id": 1, "name": "Downtown", "code": "DT01" },
    "summary": { "total": 500, "averageRating": 4.2, "negativeCount": 25 },
    "recentFeedbacks": [ { ...20 most recent... } ]
  }
}
```

**Errors:** 404 (`Branch not found`)

---

### Export Excel

**GET** `/api/v1/reports/export/excel`

**Auth:** `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`

Downloads an `.xlsx` file (limited to `REPORT_EXPORT_LIMIT` records, default 5000).

**Headers:**
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename=feedbacks.xlsx`

**Excel Columns:** ID, Branch, Guest Name, Contact, Food, Service, Environment, Event, Overall, Heard About, Age Group, Comment, Date

---

### Export PDF

**GET** `/api/v1/reports/export/pdf`

**Auth:** `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER`

**Response (501)**
```json
{
  "success": false,
  "message": "PDF export is not yet implemented"
}
```

---

## 13. System Settings APIs

Base path: `/api/v1/settings`

---

### Get Settings (Public)

**GET** `/api/v1/settings`

**Auth:** None (public)

**Response (200)**
```json
{
  "success": true,
  "message": "Settings retrieved successfully",
  "data": {
    "site_name": "X-Group Feedback",
    "timezone": "UTC"
  }
}
```

Returns all `SystemSetting` rows as a flat key-value object.

---

### Update Settings

**PUT** `/api/v1/settings`

**Auth:** `SUPER_ADMIN` (only)

**Request Body** — Arbitrary key-value pairs
```json
{
  "site_name": "X-Group Feedback",
  "timezone": "UTC"
}
```

**Response (200)** — Returns full updated settings object
```json
{
  "success": true,
  "message": "Settings updated successfully",
  "data": {
    "site_name": "X-Group Feedback",
    "timezone": "UTC"
  }
}
```

---

## 14. Health & Root Endpoints

### Health Check

**GET** `/api/v1/health`

**Auth:** None

**Response (200)** — Healthy
```json
{
  "success": true,
  "status": "ok",
  "uptime": 12345,
  "timestamp": "2026-07-13T12:00:00.000Z",
  "version": "v1",
  "database": "healthy"
}
```

**Response (503)** — Degraded
```json
{
  "success": true,
  "status": "degraded",
  "uptime": 12345,
  "timestamp": "2026-07-13T12:00:00.000Z",
  "version": "v1",
  "database": "unhealthy"
}
```

---

### Root

**GET** `/`

**Auth:** None

**Response (200)**
```json
{
  "success": true,
  "message": "X-Group Feedback Management System API",
  "data": {
    "version": "v1",
    "health": "/api/v1/health"
  }
}
```

---

## 15. Complete Endpoint Summary

| # | Method | Path | Auth Roles | Notes |
|---|---|---|---|---|
| 1 | GET | `/` | None | Root info |
| 2 | GET | `/api/v1/health` | None | Health check |
| 3 | POST | `/api/v1/auth/login` | None | Rate limited (50/15min) |
| 4 | POST | `/api/v1/auth/refresh-token` | None | Requires refreshToken cookie |
| 5 | POST | `/api/v1/auth/logout` | None | Clears cookies |
| 6 | GET | `/api/v1/auth/me` | All roles | Current user info |
| 7 | GET | `/api/v1/branches/active` | None | Public branch list |
| 8 | POST | `/api/v1/branches` | SUPER_ADMIN, ADMIN | Create branch |
| 9 | GET | `/api/v1/branches` | SUPER_ADMIN, ADMIN | List (paginated) |
| 10 | GET | `/api/v1/branches/:id` | SUPER_ADMIN, ADMIN | Get single |
| 11 | PUT | `/api/v1/branches/:id` | SUPER_ADMIN, ADMIN | Update |
| 12 | PATCH | `/api/v1/branches/:id/status` | SUPER_ADMIN, ADMIN | Toggle active |
| 13 | DELETE | `/api/v1/branches/:id` | SUPER_ADMIN, ADMIN | Soft delete |
| 14 | POST | `/api/v1/users` | SUPER_ADMIN, ADMIN | Create user |
| 15 | GET | `/api/v1/users` | SUPER_ADMIN, ADMIN | List (paginated) |
| 16 | GET | `/api/v1/users/:id` | SUPER_ADMIN, ADMIN | Get single |
| 17 | PUT | `/api/v1/users/:id` | SUPER_ADMIN, ADMIN | Update |
| 18 | PATCH | `/api/v1/users/:id/status` | SUPER_ADMIN, ADMIN | Toggle active |
| 19 | DELETE | `/api/v1/users/:id` | SUPER_ADMIN, ADMIN | Soft delete |
| 20 | POST | `/api/v1/feedbacks` | None | Public submission |
| 21 | GET | `/api/v1/feedbacks` | All roles | List (scoped) |
| 22 | GET | `/api/v1/feedbacks/:id` | All roles | Get single |
| 23 | GET | `/api/v1/dashboard/summary` | All roles | Dashboard summary |
| 24 | GET | `/api/v1/dashboard/recent-feedback` | All roles | Recent feedbacks |
| 25 | GET | `/api/v1/dashboard/branch-ranking` | SUPER_ADMIN, ADMIN | Branch comparison |
| 26 | GET | `/api/v1/dashboard/negative-feedback` | All roles | Negative feedbacks |
| 27 | GET | `/api/v1/analytics/ratings` | All roles | Rating analytics |
| 28 | GET | `/api/v1/analytics/branches` | SUPER_ADMIN, ADMIN | Branch performance |
| 29 | GET | `/api/v1/analytics/monthly` | All roles | Monthly trends |
| 30 | GET | `/api/v1/analytics/satisfaction` | All roles | Satisfaction rate |
| 31 | GET | `/api/v1/reports/daily` | All roles | Daily report |
| 32 | GET | `/api/v1/reports/weekly` | All roles | Weekly report |
| 33 | GET | `/api/v1/reports/monthly` | All roles | Monthly report |
| 34 | GET | `/api/v1/reports/branch` | All roles | Branch report |
| 35 | GET | `/api/v1/reports/export/excel` | All roles | Excel download |
| 36 | GET | `/api/v1/reports/export/pdf` | All roles | Not implemented (501) |
| 37 | GET | `/api/v1/settings` | None | Public settings |
| 38 | PUT | `/api/v1/settings` | SUPER_ADMIN | Update settings |

## 16. API Authorization Matrix

| Endpoint Group | SUPER_ADMIN | ADMIN | BRANCH_MANAGER | Guest (No Auth) |
|---|---|---|---|---|
| Health / Root | ✅ | ✅ | ✅ | ✅ |
| Login / Logout / Refresh | ✅ | ✅ | ✅ | ✅ |
| Users (all) | ✅ | ✅ | ❌ | ❌ |
| Branches (all) | ✅ | ✅ | ❌ | ❌ |
| Active Branches | ✅ | ✅ | ✅ | ✅ |
| Submit Feedback | ❌ | ❌ | ❌ | ✅ |
| View Feedback | ✅ | ✅ | ✅ (own branch) | ❌ |
| Dashboard (branch-ranking) | ✅ | ✅ | ❌ | ❌ |
| Dashboard (other) | ✅ | ✅ | ✅ (own branch) | ❌ |
| Analytics (branches) | ✅ | ✅ | ❌ | ❌ |
| Analytics (other) | ✅ | ✅ | ✅ (own branch) | ❌ |
| Reports (all) | ✅ | ✅ | ✅ (own branch) | ❌ |
| Settings (GET) | ✅ | ✅ | ✅ | ✅ |
| Settings (PUT) | ✅ | ❌ | ❌ | ❌ |

## 17. HTTP Status Codes

| Code | Description |
|---|---|
| 200 | Success |
| 201 | Resource Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 500 | Internal Server Error |
| 501 | Not Implemented |
| 503 | Service Degraded |

## 18. API Security

The API implements the following security measures:

- JWT Access Token authentication (Bearer header + HttpOnly cookie)
- HTTP-only Refresh Token cookies (prevent XSS token theft)
- Role-Based Access Control (RBAC) with granular endpoint permissions
- Password hashing with bcrypt
- Request validation using Zod schemas
- SQL injection protection via Prisma ORM
- Helmet security headers
- CORS configuration
- Rate limiting on authentication endpoints (50 requests / 15 min)
- Soft delete on sensitive entities (Branch, User)

## 19. API Versioning

Current Version: `/api/v1`
Future releases will use versioned endpoints (e.g., `/api/v2`) to maintain backward compatibility.
