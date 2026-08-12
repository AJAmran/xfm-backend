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

## 12A. Daily Manager Report APIs

Base path: `/api/v1/manager-reports`

All endpoints require `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER`.

> **Branch Manager Scope:** `BRANCH_MANAGER` requests are automatically scoped to their own branch. A `BRANCH_MANAGER` may only edit or delete a report on the day it was created (`reportDate === today`). Writes that would move a report to a different branch are forbidden.

**Nested records:** A report can include `complaints` (guest complaints) and `bpCpEntries` (briefing points / carry-over points). Both are created/updated atomically with the report inside a DB transaction.

---

### Create Manager Report

**POST** `/api/v1/manager-reports`

**Request Body**
```json
{
  "branchId": 1,
  "managerName": "Rahim Uddin",
  "reportDate": "2026-08-03",
  "managerComments": "Good evening service flow.",
  "supplyPurchaseIssues": "Rice stock running low.",
  "briefingPoints": "Reinforce table-clearing speed.",
  "dailyLearnings": "Large group handled well.",
  "complaints": [
    {
      "guestName": "Tanvir Ahmed",
      "mobile": "01711111111",
      "email": "tanvir@example.com",
      "complaintDetails": "Serving delay at table 5.",
      "serviceProviderName": "Waiter",
      "responsiblePerson": "Karim",
      "actionTaken": "Apologized and expedited order.",
      "solution": "Complimentary dessert provided."
    }
  ],
  "bpCpEntries": [
    {
      "entryType": "TOMORROW",
      "guestName": "Nusrat Jahan",
      "mobile": "01822222222",
      "comment": "VIP booking for tomorrow."
    }
  ]
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `branchId` | number (int) | Yes | Branch ID (ignored/forced for BRANCH_MANAGER) |
| `managerName` | string (min 1) | Yes | Manager's name |
| `reportDate` | string `YYYY-MM-DD` | Yes | Report date |
| `managerComments` | string | No | General comments |
| `supplyPurchaseIssues` | string | No | Supply/purchase issues |
| `briefingPoints` | string | No | Briefing points |
| `dailyLearnings` | string | No | Daily learnings |
| `complaints` | array (max 50) | No | Guest complaints (see above) |
| `bpCpEntries` | array (max 50) | No | BP/CP entries (`entryType`: `TODAY` \| `TOMORROW`) |

**Response (201)** — Created report with nested `complaints` and `bpCpEntries`

**Errors:** 404 (`Branch not found`), 409 (`A report already exists for this branch on {date}`), 422

---

### List Manager Reports

**GET** `/api/v1/manager-reports`

**Query Parameters**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | string | `"1"` | Page number |
| `limit` | string | `"10"` | Items per page |
| `sortBy` | string | `"reportDate"` | Sort field |
| `sortOrder` | `"asc"` \| `"desc"` | `"desc"` | Sort direction |
| `branchId` | string | — | Branch filter (ignored for BRANCH_MANAGER) |
| `managerName` | string | — | Filter by manager name |
| `startDate` | string `YYYY-MM-DD` | — | Start date filter |
| `endDate` | string `YYYY-MM-DD` | — | End date filter |

**Response (200)** — Paginated list (standard envelope) with nested `branch`, `complaints`, `bpCpEntries`

---

### Get Manager Report

**GET** `/api/v1/manager-reports/:id`

**Response (200)** — Single report with nested records

**Errors:** 404 (`Manager report not found`)

---

### Update Manager Report

**PATCH** `/api/v1/manager-reports/:id`

**Request Body** (all optional, same field types as create, minus `branchId`)

**Response (200)** — Updated report

**Errors:** 403 (BRANCH_MANAGER editing a previous day's report), 404

---

### Delete Manager Report (Soft Delete)

**DELETE** `/api/v1/manager-reports/:id`

**Response (200)**
```json
{ "success": true, "message": "Manager report deleted successfully", "data": {} }
```

**Errors:** 403 (BRANCH_MANAGER deleting a previous day's report), 404

---

## 12B. Guest Discount & Entertainment APIs

Base path: `/api/v1/guest-offers`

All endpoints require `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER`. Approval endpoints (`.../approval`) require `SUPER_ADMIN` or `ADMIN` only.

> **Branch Manager Scope:** `BRANCH_MANAGER` requests are automatically scoped to their own branch.
>
> **Business rule:** `discountAmount` is always computed server-side as `totalBill * discountPercent / 100`. A client-supplied value is ignored.

---

### Guest Offers Summary

**GET** `/api/v1/guest-offers/summary`

**Query Parameters**
| Param | Type | Description |
|---|---|---|
| `branchId` | string | Branch filter (ignored for BRANCH_MANAGER) |
| `startDate` | string `YYYY-MM-DD` | Start date filter |
| `endDate` | string `YYYY-MM-DD` | End date filter |

**Response (200)**
```json
{
  "success": true,
  "message": "Guest offer summary retrieved successfully",
  "data": {
    "discount": { "totalBill": 12500, "totalDiscountAmount": 875, "logs": 2 },
    "entertainment": { "totalCost": 450, "logs": 1 }
  }
}
```

---

### Create Discount Log

**POST** `/api/v1/guest-offers/discounts`

**Request Body**
```json
{
  "branchId": 1,
  "logDate": "2026-08-03",
  "guestName": "Sadia Islam",
  "mobile": "01933333333",
  "hadLunch": true,
  "hadDinner": false,
  "totalBill": 5000,
  "discountPercent": 10,
  "reasonForDiscount": "Returning VIP guest"
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `branchId` | number (int) | Yes | Branch ID (ignored/forced for BRANCH_MANAGER) |
| `logDate` | string `YYYY-MM-DD` | Yes | Date of offer |
| `guestName` | string (min 1) | Yes | Guest name |
| `mobile` | string (min 1) | Yes | Guest mobile |
| `hadLunch` | boolean | No | Guest had lunch (default false) |
| `hadDinner` | boolean | No | Guest had dinner (default false) |
| `totalBill` | number > 0 (2 dp) | Yes | Total bill before discount |
| `discountPercent` | number > 0, ≤ 100 (2 dp) | Yes | Discount percentage |
| `reasonForDiscount` | string (min 1) | Yes | Reason |

**Response (201)** — Created log with server-computed `discountAmount` (`approvalStatus: "PENDING"`)

**Errors:** 404 (`Branch not found`), 422

---

### List Discount Logs

**GET** `/api/v1/guest-offers/discounts`

**Query Parameters**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | string | `"1"` | Page number |
| `limit` | string | `"10"` | Items per page |
| `sortBy` | string | `"logDate"` | Sort field |
| `sortOrder` | `"asc"` \| `"desc"` | `"desc"` | Sort direction |
| `branchId` | string | — | Branch filter (ignored for BRANCH_MANAGER) |
| `logDate` | string `YYYY-MM-DD` | — | Exact date filter |
| `startDate` | string `YYYY-MM-DD` | — | Start date filter |
| `endDate` | string `YYYY-MM-DD` | — | End date filter |
| `approvalStatus` | enum | — | `PENDING`, `APPROVED`, `REJECTED` |
| `search` | string | — | Search `guestName` and `mobile` |

**Response (200)** — Paginated list with nested `branch` and `offeredBy`

---

### Get Discount Log

**GET** `/api/v1/guest-offers/discounts/:id`

**Response (200)** — Single log

**Errors:** 404 (`Discount log not found`)

---

### Update Discount Log

**PATCH** `/api/v1/guest-offers/discounts/:id`

**Request Body** — Any subset of the create fields (all optional)

**Response (200)** — Updated log (server re-computes `discountAmount` when `totalBill`/`discountPercent` change)

**Errors:** 404

---

### Set Discount Approval

**PATCH** `/api/v1/guest-offers/discounts/:id/approval`

**Auth:** `SUPER_ADMIN`, `ADMIN` (only)

**Request Body**
```json
{ "approvalStatus": "APPROVED" }
```
| Field | Type | Required | Description |
|---|---|---|---|
| `approvalStatus` | enum | Yes | `APPROVED` or `REJECTED` |

**Response (200)** — Updated log with `approvalStatus`, `verifiedBy`, `approvedBy`, `approvedAt`

**Errors:** 403 (BRANCH_MANAGER), 404

---

### Delete Discount Log (Soft Delete)

**DELETE** `/api/v1/guest-offers/discounts/:id`

**Response (200)** — Soft-deleted

---

### Create Entertainment Log

**POST** `/api/v1/guest-offers/entertainments`

**Request Body**
```json
{
  "branchId": 1,
  "logDate": "2026-08-03",
  "guestName": "Mehedi Hasan",
  "mobile": "01644444444",
  "hadLunch": false,
  "hadDinner": true,
  "foodName": "Grilled Salmon",
  "foodCost": 450,
  "reasonForEntertainment": "Complaint resolution"
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `branchId` | number (int) | Yes | Branch ID |
| `logDate` | string `YYYY-MM-DD` | Yes | Date of offer |
| `guestName` | string (min 1) | Yes | Guest name |
| `mobile` | string (min 1) | Yes | Guest mobile |
| `hadLunch` | boolean | No | Had lunch (default false) |
| `hadDinner` | boolean | No | Had dinner (default false) |
| `foodName` | string (min 1) | Yes | Complimentary food name |
| `foodCost` | number > 0 (2 dp) | Yes | Food cost |
| `reasonForEntertainment` | string (min 1) | Yes | Reason |

**Response (201)** — Created log (`approvalStatus: "PENDING"`)

---

### List Entertainment Logs

**GET** `/api/v1/guest-offers/entertainments`

Same query parameters as the discount list.

**Response (200)** — Paginated list

---

### Get / Update / Approve / Delete Entertainment Log

- **GET** `/api/v1/guest-offers/entertainments/:id`
- **PATCH** `/api/v1/guest-offers/entertainments/:id`
- **PATCH** `/api/v1/guest-offers/entertainments/:id/approval` — `SUPER_ADMIN`, `ADMIN` only
- **DELETE** `/api/v1/guest-offers/entertainments/:id` (soft delete)

Mirror the discount-log behaviors described above.

---

## 12C. Convention Monthly Inventory APIs

Base path: `/api/v1/inventory`

All endpoints require `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER`. Category and item **writes** require `SUPER_ADMIN` or `ADMIN` only.

> **Branch Manager Scope:** Statements created by a `BRANCH_MANAGER` are automatically assigned to their own branch.
>
> **Business rules:**
> - Creating a statement for a month auto-generates one line per active inventory item, carrying over the previous month's `closingStock` as the new `openingStock`.
> - `closingStock = openingStock + added - brokenLost - reject`, always computed server-side (never trusted from the client).
> - A submitted statement becomes read-only on the frontend; `SUPER_ADMIN`/`ADMIN` can `LOCK` a submitted statement.

---

### List Categories

**GET** `/api/v1/inventory/categories`

**Response (200)** — Array of active categories `{ id, name, sortOrder, isActive }`

---

### Create / Update / Delete Category

- **POST** `/api/v1/inventory/categories` — `SUPER_ADMIN`, `ADMIN`
- **PATCH** `/api/v1/inventory/categories/:id` — `SUPER_ADMIN`, `ADMIN`
- **DELETE** `/api/v1/inventory/categories/:id` — `SUPER_ADMIN`, `ADMIN` (soft delete)

**Create body:** `{ "name": "Chinaware", "sortOrder": 1, "isActive": true }`

---

### List Items

**GET** `/api/v1/inventory/items`

**Query Parameters**
| Param | Type | Default | Description |
|---|---|---|---|
| `categoryId` | string | — | Filter by category |
| `page` | string | `"1"` | Page number |
| `limit` | string | `"100"` | Items per page |
| `sortBy` | string | `"sortOrder"` | Sort field |
| `sortOrder` | `"asc"` \| `"desc"` | `"asc"` | Sort direction |

**Response (200)** — Paginated list of active items with nested `category`

---

### Create / Update / Delete Item

- **POST** `/api/v1/inventory/items` — `SUPER_ADMIN`, `ADMIN`
- **PATCH** `/api/v1/inventory/items/:id` — `SUPER_ADMIN`, `ADMIN`
- **DELETE** `/api/v1/inventory/items/:id` — `SUPER_ADMIN`, `ADMIN` (soft delete)

**Create body:** `{ "categoryId": 1, "name": "Rice Plate", "sortOrder": 1 }`

---

### Create Inventory Statement

**POST** `/api/v1/inventory/statements`

**Request Body**
```json
{ "branchId": 1, "statementMonth": "2026-08" }
```
| Field | Type | Required | Description |
|---|---|---|---|
| `branchId` | number (int) | No | Branch (ignored/forced for BRANCH_MANAGER; defaults to branch for others if omitted) |
| `statementMonth` | string `YYYY-MM` | Yes | Statement month |

**Response (201)** — New statement (`status: "DRAFT"`) with generated lines

**Errors:** 409 (`An inventory statement already exists for this branch and month`), 404 (`Branch not found`)

---

### List Statements

**GET** `/api/v1/inventory/statements`

**Query Parameters**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | string | `"1"` | Page number |
| `limit` | string | `"10"` | Items per page |
| `sortBy` | string | `"statementMonth"` | Sort field |
| `sortOrder` | `"asc"` \| `"desc"` | `"desc"` | Sort direction |
| `branchId` | string | — | Branch filter (ignored for BRANCH_MANAGER) |
| `statementMonth` | string `YYYY-MM` | — | Month filter |
| `status` | enum | — | `DRAFT`, `SUBMITTED`, `LOCKED` |

**Response (200)** — Paginated list with nested `branch`

---

### Get Statement

**GET** `/api/v1/inventory/statements/:id`

**Response (200)** — Statement with nested `branch`

---

### Get Statement Lines (Grouped)

**GET** `/api/v1/inventory/statements/:id/lines`

**Response (200)** — Array of lines, each with nested item and category:
```json
{
  "success": true,
  "message": "Inventory statement lines retrieved successfully",
  "data": [
    {
      "id": 1,
      "itemId": 3,
      "openingStock": 200,
      "added": 50,
      "brokenLost": 2,
      "reject": 1,
      "closingStock": 247,
      "item": { "name": "Rice Plate", "category": { "name": "Chinaware" } }
    }
  ]
}
```

---

### Update Statement Lines

**PATCH** `/api/v1/inventory/statements/:id/lines`

**Request Body**
```json
{
  "lines": [
    { "itemId": 3, "added": 50, "brokenLost": 2, "reject": 1 },
    { "itemId": 4, "added": 10 }
  ]
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `lines[].itemId` | number (int) | Yes | Item ID (must belong to this statement) |
| `lines[].added` | number (int ≥ 0) | No | Units added |
| `lines[].brokenLost` | number (int ≥ 0) | No | Units broken/lost |
| `lines[].reject` | number (int ≥ 0) | No | Units rejected |

**Response (200)** — Updated statement with recomputed `closingStock` per line

**Errors:** 404 (`Statement not found`), 400 (item does not belong to the statement / statement not editable)

---

### Update Statement Status

**PATCH** `/api/v1/inventory/statements/:id/status`

**Request Body**
```json
{ "status": "SUBMITTED" }
```
| Field | Type | Required | Description |
|---|---|---|---|
| `status` | enum | Yes | `SUBMITTED` or `LOCKED` |

**Response (200)** — Updated statement (`submittedAt` is set on first submit)

**Errors:** 404, 400 (invalid transition, e.g. editing a locked statement)

---

## 12D. Operational Dashboard Widgets

Base path: `/api/v1/dashboard`

### Operational Widgets

**GET** `/api/v1/dashboard/operational-widgets`

**Auth:** `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER` (scoped to own branch)

**Response (200)**
```json
{
  "success": true,
  "message": "Operational widgets retrieved successfully",
  "data": {
    "pendingApprovals": { "total": 3, "discounts": 2, "entertainments": 1 },
    "managerReportsSubmittedToday": 2,
    "inventoryThisMonth": { "submitted": 4, "draft": 9, "branchesWithStatement": 13 }
  }
}
```

---

## 12E. Reports Module Excel Exports

Base path: `/api/v1/reports`

All require `SUPER_ADMIN`, `ADMIN`, or `BRANCH_MANAGER` (scoped to own branch). All honor `startDate`/`endDate` (YYYY-MM-DD) query params and are bounded by `REPORT_EXPORT_LIMIT`.

| Endpoint | Filename | Sheets / Columns |
|---|---|---|
| `GET /api/v1/reports/export/excel/manager-reports` | `manager-reports.xlsx` | "Manager Reports" + "Guest Complaints" |
| `GET /api/v1/reports/export/excel/guest-offers/discounts` | `guest-discount-logs.xlsx` | "Discount Logs" |
| `GET /api/v1/reports/export/excel/guest-offers/entertainments` | `guest-entertainment-logs.xlsx` | "Entertainment Logs" |
| `GET /api/v1/reports/export/excel/inventory` | `inventory-statement.xlsx` | One sheet per branch/month with Category, Item, Opening, Added, Broken/Lost, Reject, Closing |

The inventory export also accepts `statementMonth` (YYYY-MM); when omitted it exports the current month.

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
| 36 | GET | `/api/v1/reports/export/excel/manager-reports` | All roles | Manager reports Excel |
| 37 | GET | `/api/v1/reports/export/excel/guest-offers/discounts` | All roles | Discount logs Excel |
| 38 | GET | `/api/v1/reports/export/excel/guest-offers/entertainments` | All roles | Entertainment logs Excel |
| 39 | GET | `/api/v1/reports/export/excel/inventory` | All roles | Inventory statement Excel |
| 40 | GET | `/api/v1/reports/export/pdf` | All roles | Not implemented (501) |
| 41 | GET | `/api/v1/manager-reports` | All roles | List manager reports (scoped) |
| 42 | POST | `/api/v1/manager-reports` | All roles | Create manager report |
| 43 | GET | `/api/v1/manager-reports/:id` | All roles | Get manager report |
| 44 | PATCH | `/api/v1/manager-reports/:id` | All roles | Update manager report |
| 45 | DELETE | `/api/v1/manager-reports/:id` | All roles | Soft delete manager report |
| 46 | GET | `/api/v1/guest-offers/summary` | All roles | Guest offer summary |
| 47 | GET | `/api/v1/guest-offers/discounts` | All roles | List discount logs |
| 48 | POST | `/api/v1/guest-offers/discounts` | All roles | Create discount log |
| 49 | GET | `/api/v1/guest-offers/discounts/:id` | All roles | Get discount log |
| 50 | PATCH | `/api/v1/guest-offers/discounts/:id` | All roles | Update discount log |
| 51 | PATCH | `/api/v1/guest-offers/discounts/:id/approval` | SUPER_ADMIN, ADMIN | Approve/reject discount |
| 52 | DELETE | `/api/v1/guest-offers/discounts/:id` | All roles | Soft delete discount log |
| 53 | GET | `/api/v1/guest-offers/entertainments` | All roles | List entertainment logs |
| 54 | POST | `/api/v1/guest-offers/entertainments` | All roles | Create entertainment log |
| 55 | GET | `/api/v1/guest-offers/entertainments/:id` | All roles | Get entertainment log |
| 56 | PATCH | `/api/v1/guest-offers/entertainments/:id` | All roles | Update entertainment log |
| 57 | PATCH | `/api/v1/guest-offers/entertainments/:id/approval` | SUPER_ADMIN, ADMIN | Approve/reject entertainment |
| 58 | DELETE | `/api/v1/guest-offers/entertainments/:id` | All roles | Soft delete entertainment log |
| 59 | GET | `/api/v1/inventory/categories` | All roles | List categories |
| 60 | POST | `/api/v1/inventory/categories` | SUPER_ADMIN, ADMIN | Create category |
| 61 | PATCH | `/api/v1/inventory/categories/:id` | SUPER_ADMIN, ADMIN | Update category |
| 62 | DELETE | `/api/v1/inventory/categories/:id` | SUPER_ADMIN, ADMIN | Soft delete category |
| 63 | GET | `/api/v1/inventory/items` | All roles | List items |
| 64 | POST | `/api/v1/inventory/items` | SUPER_ADMIN, ADMIN | Create item |
| 65 | PATCH | `/api/v1/inventory/items/:id` | SUPER_ADMIN, ADMIN | Update item |
| 66 | DELETE | `/api/v1/inventory/items/:id` | SUPER_ADMIN, ADMIN | Soft delete item |
| 67 | POST | `/api/v1/inventory/statements` | All roles | Create statement |
| 68 | GET | `/api/v1/inventory/statements` | All roles | List statements (scoped) |
| 69 | GET | `/api/v1/inventory/statements/:id` | All roles | Get statement |
| 70 | GET | `/api/v1/inventory/statements/:id/lines` | All roles | Get grouped lines |
| 71 | PATCH | `/api/v1/inventory/statements/:id/lines` | All roles | Update lines |
| 72 | PATCH | `/api/v1/inventory/statements/:id/status` | All roles | Submit/lock statement |
| 73 | GET | `/api/v1/dashboard/operational-widgets` | All roles | Operational widgets |
| 74 | GET | `/api/v1/settings` | None | Public settings |
| 75 | PUT | `/api/v1/settings` | SUPER_ADMIN | Update settings |

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
| Manager Reports (all) | ✅ | ✅ | ✅ (own branch, same-day edits) | ❌ |
| Guest Offers (view/create/update/delete) | ✅ | ✅ | ✅ (own branch) | ❌ |
| Guest Offers (approval) | ✅ | ✅ | ❌ | ❌ |
| Inventory (categories/items writes) | ✅ | ✅ | ❌ | ❌ |
| Inventory (statements) | ✅ | ✅ | ✅ (own branch) | ❌ |
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
