# API Testing Guide — X-Group Feedback System

This guide covers every endpoint from every possible angle: happy path, auth failures, validation errors, role enforcement, and edge cases. Use any HTTP client — `curl`, Postman, Thunder Client, or HTTPie.

---

## Setup

### Base URL

```
http://localhost:5000
```

### Start the server
```bash
npm run dev
```fdddd

### Variables used in this guide

```
BASE = http://localhost:5000/api/v1
ACCESS_TOKEN = (from login response body)
```

---

## 1. Health Check

### ✅ Server is running

```http
GET {{BASE}}/health
```

**Expected 200:**
```json
{
  "success": true,
  "status": "ok",
  "uptime": 42,
  "timestamp": "2026-07-11T07:00:00.000Z",
  "version": "v1"
}
```

### ✅ Root endpoint

```http
GET http://localhost:5000/
```

---

## 2. Authentication

### ✅ Login — Super Admin

```http
POST {{BASE}}/auth/login
Content-Type: application/json

{
  "email": "superadmin@x-grouprestaurant.com",
  "password": "SuperAdmin@123"
}
```

**Expected 200:** Returns `accessToken` in body and sets `accessToken` + `refreshToken` cookies.

```json
{
  "success": true,
  "message": "User logged in successfully",
  "data": {
    "accessToken": "eyJhbGci...",
    "user": {
      "id": 1,
      "name": "Super Administrator",
      "email": "superadmin@x-grouprestaurant.com",
      "role": "SUPER_ADMIN"
    }
  }
}
```

---

### ✅ Login — Admin

```http
POST {{BASE}}/auth/login
Content-Type: application/json

{
  "email": "admin@x-grouprestaurant.com",
  "password": "Admin@123"
}
```

---

### ✅ Login — Branch Manager (X-01)

```http
POST {{BASE}}/auth/login
Content-Type: application/json

{
  "email": "xian@x-grouprestaurant.com",
  "password": "Xian@123"
}
```

---

### ❌ Wrong password

```http
POST {{BASE}}/auth/login
Content-Type: application/json

{
  "email": "admin@x-grouprestaurant.com",
  "password": "WrongPassword"
}
```

**Expected 401:** `"Incorrect password"`

---

### ❌ Email not found

```http
POST {{BASE}}/auth/login
Content-Type: application/json

{
  "email": "notexist@test.com",
  "password": "Admin@123"
}
```

**Expected 404:** `"No account found matching that email address"`

---

### ❌ Missing fields (Zod validation)

```http
POST {{BASE}}/auth/login
Content-Type: application/json

{
  "email": "not-an-email",
  "password": "short"
}
```

**Expected 422:** Field-level validation errors for `email` and `password`.

---

### ❌ Empty body

```http
POST {{BASE}}/auth/login
Content-Type: application/json

{}
```

**Expected 422:** Validation errors for required fields.

---

### ✅ Get current user (me)

```http
GET {{BASE}}/auth/me
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected 200:** Returns the authenticated user object (no password field).

---

### ❌ Access protected route without token

```http
GET {{BASE}}/auth/me
```

**Expected 401:** `"You are not authorized to access this resource"`

---

### ❌ Access with invalid token

```http
GET {{BASE}}/auth/me
Authorization: Bearer invalid.token.here
```

**Expected 401:** `"Invalid or expired access token"`

---

### ✅ Refresh access token

```http
POST {{BASE}}/auth/refresh-token
Cookie: refreshToken=<your-refresh-token>
```

> In Postman: after login, the cookie is set automatically. Just call this endpoint.
> In curl: pass `--cookie "refreshToken=<token>"`.

**Expected 200:** Returns new `accessToken`.

---

### ❌ Refresh without cookie

```http
POST {{BASE}}/auth/refresh-token
```

**Expected 401:** `"Refresh token not found"`

---

### ✅ Logout

```http
POST {{BASE}}/auth/logout
Cookie: refreshToken=<your-refresh-token>
```

**Expected 200:** Cookies cleared.

---

### ⚠ Rate Limit — Auth Limiter (10 req / 15 min)

Send 11+ POST requests to `/auth/login` from the same IP.

**Expected on 11th request — 429:**
```json
{
  "success": false,
  "message": "Too many login attempts. Please try again in 15 minutes.",
  "errors": []
}
```

---

## 3. Branches

### ✅ Public — List active branches (no auth)

```http
GET {{BASE}}/branches/active
```

**Expected 200:** Array of 15 active branches (id, name, code, address, phone).

---

### ✅ Admin — List all branches (paginated)

```http
GET {{BASE}}/branches?page=1&limit=10&sortBy=name&sortOrder=asc
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Filter by search

```http
GET {{BASE}}/branches?search=Dhanmondi
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Filter by status

```http
GET {{BASE}}/branches?isActive=true
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Get branch by ID

```http
GET {{BASE}}/branches/1
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ❌ Branch not found

```http
GET {{BASE}}/branches/99999
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected 404:** `"Branch not found"`

---

### ✅ Admin — Create branch

```http
POST {{BASE}}/branches
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "name": "Test Branch",
  "code": "X-TEST",
  "address": "123 Test Road, Dhaka",
  "phone": "01700000000",
  "latitude": 23.7500,
  "longitude": 90.3800
}
```

**Expected 201:** Created branch object.

---

### ❌ Duplicate branch code

```http
POST {{BASE}}/branches
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "name": "Duplicate",
  "code": "X-01",
  "address": "Any address",
  "phone": "01700000000",
  "latitude": 23.75,
  "longitude": 90.38
}
```

**Expected 409:** `"A branch with this code already exists."`

---

### ✅ Admin — Update branch

```http
PUT {{BASE}}/branches/1
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "phone": "01999999999"
}
```

---

### ✅ Admin — Deactivate branch

```http
PATCH {{BASE}}/branches/1/status
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "isActive": false
}
```

---

### ✅ Admin — Soft delete branch

```http
DELETE {{BASE}}/branches/1
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected 200:** `"Branch deleted successfully"`

---

### ❌ Branch Manager cannot manage branches

Login as a Branch Manager, then:

```http
POST {{BASE}}/branches
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
Content-Type: application/json

{ "name": "Unauthorized", "code": "X-XX", "address": "test", "phone": "0111", "latitude": 23, "longitude": 90 }
```

**Expected 403:** `"Forbidden: You do not have permission to perform this action"`

---

## 4. Feedback (Guest Submission)

### ✅ Submit feedback (no auth required)

```http
POST {{BASE}}/feedbacks
Content-Type: application/json

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

**Expected 201:** Created feedback object.

---

### ✅ Submit minimal feedback (optional fields omitted)

```http
POST {{BASE}}/feedbacks
Content-Type: application/json

{
  "branchId": 2,
  "guestName": "Jane",
  "foodRating": 4,
  "serviceRating": 4,
  "environmentRating": 4,
  "eventRating": 3,
  "overallRating": 4
}
```

---

### ❌ Invalid branchId (inactive or not found)

```http
POST {{BASE}}/feedbacks
Content-Type: application/json

{
  "branchId": 99999,
  "guestName": "Test",
  "foodRating": 4,
  "serviceRating": 4,
  "environmentRating": 4,
  "eventRating": 4,
  "overallRating": 4
}
```

**Expected 404:** `"Branch not found or inactive"`

---

### ❌ Rating below minimum (Zod — min 3)

```http
POST {{BASE}}/feedbacks
Content-Type: application/json

{
  "branchId": 1,
  "guestName": "Test",
  "foodRating": 1,
  "serviceRating": 4,
  "environmentRating": 4,
  "eventRating": 4,
  "overallRating": 4
}
```

**Expected 422:** `"Input validation failed"` with `foodRating` error.

---

### ❌ Invalid enum value

```http
POST {{BASE}}/feedbacks
Content-Type: application/json

{
  "branchId": 1,
  "guestName": "Test",
  "foodRating": 4,
  "serviceRating": 4,
  "environmentRating": 4,
  "eventRating": 4,
  "overallRating": 4,
  "heardAbout": "INVALID_VALUE"
}
```

**Expected 422:** Enum validation error on `heardAbout`.

---

### ✅ Admin — List feedbacks (paginated)

```http
GET {{BASE}}/feedbacks?page=1&limit=10
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Filter by branch

```http
GET {{BASE}}/feedbacks?branchId=1&limit=5
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Filter by date range

```http
GET {{BASE}}/feedbacks?startDate=2026-01-01&endDate=2026-07-11
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Search by guest name

```http
GET {{BASE}}/feedbacks?search=Rafiq
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Filter by rating

```http
GET {{BASE}}/feedbacks?rating=5
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Branch Manager — auto-scoped to own branch

Login as `xian@x-grouprestaurant.com` (X-01), then:

```http
GET {{BASE}}/feedbacks
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
```

**Expected:** Only feedbacks for branch X-01 — even without passing `branchId`.

---

### ⚠ Pagination abuse — max limit enforced

```http
GET {{BASE}}/feedbacks?limit=999999
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:** Returns max 100 records, not 999999.

---

### ✅ Get feedback by ID

```http
GET {{BASE}}/feedbacks/1
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ❌ Feedback not found

```http
GET {{BASE}}/feedbacks/99999
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected 404:** `"Feedback not found"`

---

## 5. Users

### ✅ Admin — Create user

```http
POST {{BASE}}/users
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "name": "Test Manager",
  "email": "testmanager@x-grouprestaurant.com",
  "password": "Test@1234",
  "role": "BRANCH_MANAGER",
  "branchId": 1
}
```

**Expected 201:** User object (no password field).

---

### ❌ Duplicate email

```http
POST {{BASE}}/users
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "name": "Duplicate",
  "email": "admin@x-grouprestaurant.com",
  "password": "Admin@123",
  "role": "ADMIN"
}
```

**Expected 409:** `"A user with this email already exists"`

---

### ✅ Admin — List users

```http
GET {{BASE}}/users?page=1&limit=10&sortBy=name&sortOrder=asc
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Filter by role

```http
GET {{BASE}}/users?role=BRANCH_MANAGER
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Search users

```http
GET {{BASE}}/users?search=Xian
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Get user by ID

```http
GET {{BASE}}/users/1
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Admin — Update user

```http
PUT {{BASE}}/users/2
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "name": "Updated Name"
}
```

---

### ✅ Admin — Deactivate user

```http
PATCH {{BASE}}/users/2/status
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "isActive": false
}
```

---

### ✅ Verify deactivated user cannot login

After deactivating, try logging in as that user.

**Expected 403:** `"Your account has been suspended"`

---

### ✅ Admin — Soft-delete user

```http
DELETE {{BASE}}/users/2
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ❌ Delete non-existent user

```http
DELETE {{BASE}}/users/99999
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected 404:** `"The requested record was not found."`

---

### ❌ Branch Manager cannot access users

```http
GET {{BASE}}/users
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
```

**Expected 403:** Forbidden.

---

## 6. Dashboard

### ✅ Summary — Admin (all branches)

```http
GET {{BASE}}/dashboard/summary
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected 200:**
```json
{
  "data": {
    "totalFeedbacks": 120,
    "averageRatings": { "overallRating": 4.1, "foodRating": 4.3, ... },
    "negativeFeedbackCount": 5,
    "ratingDistribution": [ { "rating": 3, "count": 20 }, ... ],
    "recentFeedbacks": [ ... ]
  }
}
```

---

### ✅ Summary — Branch Manager (own branch only)

Login as `xian@x-grouprestaurant.com`, then:

```http
GET {{BASE}}/dashboard/summary
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
```

**Expected:** Same structure but only data for X-01.

---

### ✅ Recent feedback

```http
GET {{BASE}}/dashboard/recent-feedback
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:** Last 20 feedbacks with branch name.

---

### ✅ Branch ranking — Admin only

```http
GET {{BASE}}/dashboard/branch-ranking
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:** All branches ordered by average overall rating, with branch name and code.

---

### ❌ Branch Manager cannot see ranking

```http
GET {{BASE}}/dashboard/branch-ranking
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
```

**Expected 403:** Forbidden.

---

### ✅ Negative feedback

```http
GET {{BASE}}/dashboard/negative-feedback
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:** Feedbacks with `overallRating ≤ 2`.

---

## 7. Analytics

### ✅ Rating analytics

```http
GET {{BASE}}/analytics/ratings
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:**
```json
{
  "data": {
    "averages": { "overallRating": 4.1, "foodRating": 4.3, ... },
    "totalFeedbacks": 120,
    "distribution": [
      { "rating": 3, "count": 20, "percentage": 17 },
      { "rating": 4, "count": 60, "percentage": 50 },
      { "rating": 5, "count": 40, "percentage": 33 }
    ]
  }
}
```

---

### ✅ Branch performance — Admin only

```http
GET {{BASE}}/analytics/branches
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:** All 15 branches with their average ratings and feedback count.

---

### ❌ Branch Manager cannot see all branch performance

```http
GET {{BASE}}/analytics/branches
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
```

**Expected 403:** Forbidden.

---

### ✅ Monthly trends (DB-aggregated)

```http
GET {{BASE}}/analytics/monthly
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:** Monthly data for last 6 months (seeded spread):
```json
{
  "data": [
    { "month": "2026-02", "averageRating": 4.1, "totalFeedbacks": 18 },
    { "month": "2026-03", "averageRating": 4.3, "totalFeedbacks": 22 },
    ...
  ]
}
```

---

### ✅ Customer satisfaction

```http
GET {{BASE}}/analytics/satisfaction
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:**
```json
{
  "data": {
    "satisfactionRate": 92,
    "totalFeedbacks": 120,
    "averageRating": 4.1,
    "negativeFeedbackCount": 8,
    "category": "Excellent"
  }
}
```

---

## 8. Reports

### ✅ Daily report

```http
GET {{BASE}}/reports/daily
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Weekly report

```http
GET {{BASE}}/reports/weekly
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Monthly report

```http
GET {{BASE}}/reports/monthly
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Branch report — Admin specifying a branch

```http
GET {{BASE}}/reports/branch?branchId=1
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Branch report — Branch Manager (auto-scoped)

```http
GET {{BASE}}/reports/branch
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
```

**Expected:** Report for the manager's own branch.

---

### ✅ Export Excel — all branches

```http
GET {{BASE}}/reports/export/excel
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected:** Binary `.xlsx` file download.
Response headers:
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename=feedbacks.xlsx
```

---

### ✅ Export Excel — date range filter

```http
GET {{BASE}}/reports/export/excel?startDate=2026-01-01&endDate=2026-07-11
Authorization: Bearer {{ACCESS_TOKEN}}
```

---

### ✅ Export Excel — Branch Manager (own branch only)

```http
GET {{BASE}}/reports/export/excel
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
```

---

## 9. Settings

### ✅ Get settings (public — no auth)

```http
GET {{BASE}}/settings
```

**Expected 200:**
```json
{
  "data": {
    "company_name": "X-Group Restaurant",
    "contact_email": "info@x-grouprestaurant.com",
    "contact_phone": "01329661662",
    "feedback_form_active": "true",
    "company_address": "212 New Elephant Road, Dhaka-1205"
  }
}
```

---

### ✅ Super Admin — Update settings

```http
PUT {{BASE}}/settings
Authorization: Bearer {{SUPER_ADMIN_TOKEN}}
Content-Type: application/json

{
  "company_name": "X-Group Restaurants Ltd.",
  "contact_phone": "01900000000"
}
```

**Expected 200:** Full settings object with updated values.

---

### ❌ Admin cannot update settings (only SUPER_ADMIN)

```http
PUT {{BASE}}/settings
Authorization: Bearer {{ADMIN_TOKEN}}
Content-Type: application/json

{ "company_name": "Unauthorized" }
```

**Expected 403:** Forbidden.

---

### ❌ Branch Manager cannot update settings

```http
PUT {{BASE}}/settings
Authorization: Bearer {{BRANCH_MANAGER_TOKEN}}
Content-Type: application/json

{ "company_name": "Unauthorized" }
```

**Expected 403:** Forbidden.

---

## 10. Edge Cases & Error Scenarios

### ❌ 404 — Unknown route

```http
GET {{BASE}}/nonexistent-endpoint
```

**Expected 404:** Express default not-found (or your custom handler).

---

### ❌ 413 — Payload too large (body > 10kb)

Send a JSON body larger than 10kb.

**Expected 413:** `"request entity too large"`

---

### ⚠ Global rate limit (500 req / 15 min)

Send 501+ requests rapidly from the same IP.

**Expected 429:** `"Too many requests. Please try again later."`

---

### ✅ CORS — valid origin

Request from `http://localhost:3000` (matches `APP_URL`).

**Expected:** Response includes `Access-Control-Allow-Origin: http://localhost:3000`.

---

### ❌ CORS — invalid origin

Request from `http://evil.com`.

**Expected:** No CORS headers, browser blocks the request.

---

### ✅ Health — server uptime increases

Call `/health` twice, a few seconds apart, and verify `uptime` increases.

---

## 11. curl Quick Reference

```bash
BASE="http://localhost:5000/api/v1"

# Health check
curl "$BASE/health"

# Login and capture token
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@x-grouprestaurant.com","password":"Admin@123"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "Token: $TOKEN"

# Authenticated request
curl -H "Authorization: Bearer $TOKEN" "$BASE/dashboard/summary"

# Submit feedback (public)
curl -X POST "$BASE/feedbacks" \
  -H "Content-Type: application/json" \
  -d '{"branchId":1,"guestName":"Test","foodRating":5,"serviceRating":5,"environmentRating":5,"eventRating":5,"overallRating":5}'

# Download Excel report
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/reports/export/excel" \
  --output feedbacks.xlsx
```

---

## 12. Postman / Thunder Client Setup

1. Create an environment with variable `BASE_URL = http://localhost:5000/api/v1`
2. Create a variable `TOKEN` (empty initially)
3. On the **Login** request, add a **Post-response Script**:
   ```javascript
   const json = pm.response.json();
   pm.environment.set("TOKEN", json.data.accessToken);
   ```
4. On all authenticated requests, set:
   - Header: `Authorization: Bearer {{TOKEN}}`
5. Enable **"Send cookies"** to test the cookie-based refresh token flow.

---

## 13. Test Scenarios Checklist

### Auth Flow
- [ ] Login as each role (super admin, admin, branch manager)
- [ ] Access `/auth/me` with valid token
- [ ] Access protected route with no token → 401
- [ ] Access protected route with expired token → 401
- [ ] Refresh token flow
- [ ] Logout + verify cookies are cleared
- [ ] Login with wrong password → 401
- [ ] Trigger auth rate limit → 429

### Role Enforcement
- [ ] Branch Manager cannot access `/users` → 403
- [ ] Branch Manager cannot create/edit/delete branches → 403
- [ ] Branch Manager cannot see branch ranking → 403
- [ ] Branch Manager cannot see all-branch analytics → 403
- [ ] Admin cannot update settings → 403
- [ ] Branch Manager auto-scoped on feedback list, dashboard, analytics, reports

### Validation
- [ ] Empty body on login → 422
- [ ] Invalid email format → 422
- [ ] Rating below 3 on feedback → 422
- [ ] Invalid enum value (heardAbout) → 422
- [ ] Missing required fields on user create → 422

### Business Rules
- [ ] Duplicate branch code → 409
- [ ] Duplicate user email → 409
- [ ] Feedback to inactive/deleted branch → 404
- [ ] Get deleted user by ID → 404
- [ ] Get deleted branch by ID → 404

### Performance
- [ ] `?limit=999999` is capped at 100
- [ ] Monthly trends returns one row per month (not all rows)
- [ ] Excel export downloads correctly
- [ ] Dashboard summary returns all 5 data points in one request
