const BASE = 'http://localhost:5000/api/v1';

let passed = 0;
let failed = 0;
const errors = [];
const tokens = {};

async function req(method, path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const res = await fetch(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') || '';
  let body;
  if (ct.includes('json')) body = await res.json();
  else body = { _text: await res.text() };
  return { status: res.status, headers: res.headers, body };
}

function test(name, fn) {
  return fn().then(r => {
    if (r.status === 'ok') { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; errors.push({ name, error: r.error }); console.log(`  ❌ ${name}: ${r.error}`); }
  }).catch(err => {
    failed++; errors.push({ name, error: err.message }); console.log(`  💥 ${name}: ${err.message}`);
  });
}

function ok(name, fn) {
  return test(name, async () => {
    const { status, body } = await fn();
    if (status < 200 || status >= 300) return { status: 'fail', error: `Expected 2xx, got ${status}: ${JSON.stringify(body).slice(0,180)}` };
    return { status: 'ok' };
  });
}

function status(name, s, fn) {
  return test(name, async () => {
    const { status, body } = await fn();
    if (status !== s) return { status: 'fail', error: `Expected ${s}, got ${status}: ${JSON.stringify(body).slice(0,180)}` };
    return { status: 'ok' };
  });
}

function auth(headers) {
  return { ...headers, Authorization: `Bearer ${tokens.ACCESS_TOKEN}` };
}
function bmAuth(headers) {
  return { ...headers, Authorization: `Bearer ${tokens.BRANCH_MANAGER}` };
}

console.log('\n========================================');
console.log('  X-Group Feedback API — Full Test Suite');
console.log('========================================\n');

// ── 1. HEALTH ──
console.log('\n📋 1. Health Check\n');
await ok('GET /health', () => req('GET', '/health'));
await ok('GET /', () => req('GET', 'http://localhost:5000/'));

// ── 2. AUTH — SUCCESSFUL LOGINS FIRST ──
console.log('\n📋 2. Authentication (Logins first to avoid rate limit)\n');

await test('Login — Super Admin', async () => {
  const { status, body } = await req('POST', '/auth/login', { body: { email: 'superadmin@x-grouprestaurant.com', password: 'SuperAdmin@123' } });
  if (status !== 200 || !body.data?.accessToken) return { status: 'fail', error: `Expected 200+token, got ${status}` };
  tokens.SUPER_ADMIN = body.data.accessToken;
  tokens.ACCESS_TOKEN = body.data.accessToken;
  return { status: 'ok' };
});

await test('Login — Admin', async () => {
  const { status, body } = await req('POST', '/auth/login', { body: { email: 'admin@x-grouprestaurant.com', password: 'Admin@123' } });
  if (status !== 200) return { status: 'fail', error: `Got ${status}` };
  tokens.ADMIN = body.data.accessToken;
  return { status: 'ok' };
});

await test('Login — Branch Manager', async () => {
  const { status, body } = await req('POST', '/auth/login', { body: { email: 'xian@x-grouprestaurant.com', password: 'Xian@123' } });
  if (status !== 200) return { status: 'fail', error: `Got ${status}` };
  tokens.BRANCH_MANAGER = body.data.accessToken;
  return { status: 'ok' };
});

console.log('\n📋 2b. Auth — Protected & Error Cases\n');

await ok('GET /auth/me (with token)', () => req('GET', '/auth/me', { headers: auth() }));
await status('GET /auth/me (no token) — 401', 401, () => req('GET', '/auth/me'));
await status('GET /auth/me (invalid token) — 401', 401, () => req('GET', '/auth/me', { headers: { Authorization: 'Bearer invalid.token.here' } }));
await status('POST /auth/refresh-token (no cookie) — 401', 401, () => req('POST', '/auth/refresh-token'));
await status('POST /auth/login (wrong password) — 401', 401, () => req('POST', '/auth/login', { body: { email: 'xian@x-grouprestaurant.com', password: 'WrongPassword' } }));
await status('POST /auth/login (email not found) — 404', 404, () => req('POST', '/auth/login', { body: { email: 'notexist@test.com', password: 'Admin@123' } }));
await status('POST /auth/login (invalid email+short pwd) — 422', 422, () => req('POST', '/auth/login', { body: { email: 'not-an-email', password: 'short' } }));
await status('POST /auth/login (empty body) — 422', 422, () => req('POST', '/auth/login', { body: {} }));

// ── 3. BRANCHES ──
console.log('\n📋 3. Branches\n');
await ok('GET /branches/active (public)', () => req('GET', '/branches/active'));
await ok('GET /branches (paginated)', () => req('GET', '/branches?page=1&limit=10', { headers: auth() }));
await ok('GET /branches?search=Dhanmondi', () => req('GET', '/branches?search=Dhanmondi', { headers: auth() }));
await ok('GET /branches?isActive=true', () => req('GET', '/branches?isActive=true', { headers: auth() }));
await ok('GET /branches/1', () => req('GET', '/branches/1', { headers: auth() }));
await status('GET /branches/99999 — 404', 404, () => req('GET', '/branches/99999', { headers: auth() }));
await status('POST /branches (create) — 201', 201, () => req('POST', '/branches', { headers: auth(), body: { name: 'Test Branch', code: `X-TEST-${Date.now()}`, address: '123 Test Road', phone: '01700000000', latitude: 23.75, longitude: 90.38 } }));
await status('POST /branches (duplicate code) — 409', 409, () => req('POST', '/branches', { headers: auth(), body: { name: 'Duplicate', code: 'X-01', address: 'Any', phone: '01700000000', latitude: 23.75, longitude: 90.38 } }));
await ok('PUT /branches/1', () => req('PUT', '/branches/1', { headers: auth(), body: { phone: '01999999999' } }));
await ok('PATCH /branches/1/status (deactivate)', () => req('PATCH', '/branches/1/status', { headers: auth(), body: { isActive: false } }));
// Reactivate
await req('PATCH', '/branches/1/status', { headers: auth(), body: { isActive: true } });
await status('Branch Manager cannot POST /branches — 403', 403, () => req('POST', '/branches', { headers: bmAuth(), body: { name: 'X', code: 'X-XX', address: 't', phone: '0111', latitude: 23, longitude: 90 } }));

// ── 4. FEEDBACK ──
console.log('\n📋 4. Feedback\n');
await status('POST /feedbacks (full) — 201', 201, () => req('POST', '/feedbacks', { body: { branchId: 1, guestName: 'John Doe', contact: '01711111111', foodRating: 5, serviceRating: 4, environmentRating: 5, eventRating: 4, overallRating: 5, heardAbout: 'SOCIAL_MEDIA', ageGroup: 'AGE_18_30', opinion: 'Amazing!' } }));
await status('POST /feedbacks (minimal) — 201', 201, () => req('POST', '/feedbacks', { body: { branchId: 2, guestName: 'Jane', foodRating: 4, serviceRating: 4, environmentRating: 4, eventRating: 3, overallRating: 4 } }));
await status('POST /feedbacks (invalid branchId) — 404', 404, () => req('POST', '/feedbacks', { body: { branchId: 99999, guestName: 'Test', foodRating: 4, serviceRating: 4, environmentRating: 4, eventRating: 4, overallRating: 4 } }));
await status('POST /feedbacks (rating below 3) — 422', 422, () => req('POST', '/feedbacks', { body: { branchId: 1, guestName: 'Test', foodRating: 1, serviceRating: 4, environmentRating: 4, eventRating: 4, overallRating: 4 } }));
await status('POST /feedbacks (invalid enum) — 422', 422, () => req('POST', '/feedbacks', { body: { branchId: 1, guestName: 'Test', foodRating: 4, serviceRating: 4, environmentRating: 4, eventRating: 4, overallRating: 4, heardAbout: 'INVALID_VALUE' } }));
await ok('GET /feedbacks (paginated)', () => req('GET', '/feedbacks?page=1&limit=10', { headers: auth() }));
await ok('GET /feedbacks?branchId=1', () => req('GET', '/feedbacks?branchId=1&limit=5', { headers: auth() }));
await ok('GET /feedbacks?startDate..endDate', () => req('GET', '/feedbacks?startDate=2026-01-01&endDate=2026-07-11', { headers: auth() }));
await ok('GET /feedbacks?search=Rafiq', () => req('GET', '/feedbacks?search=Rafiq', { headers: auth() }));
await ok('GET /feedbacks?rating=5', () => req('GET', '/feedbacks?rating=5', { headers: auth() }));
await ok('GET /feedbacks (BM scoped)', () => req('GET', '/feedbacks', { headers: bmAuth() }));
await ok('GET /feedbacks?limit=999999 (capped)', () => req('GET', '/feedbacks?limit=999999', { headers: auth() }));
await ok('GET /feedbacks/1', () => req('GET', '/feedbacks/1', { headers: auth() }));
await status('GET /feedbacks/99999 — 404', 404, () => req('GET', '/feedbacks/99999', { headers: auth() }));

// ── 5. USERS ──
console.log('\n📋 5. Users\n');
await status('POST /users (create) — 201', 201, () => req('POST', '/users', { headers: auth(), body: { name: 'Test Manager', email: `testmanager${Date.now()}@x-grouprestaurant.com`, password: 'Test@1234', role: 'BRANCH_MANAGER', branchId: 1 } }));
await status('POST /users (duplicate email) — 409', 409, () => req('POST', '/users', { headers: auth(), body: { name: 'Dup', email: 'admin@x-grouprestaurant.com', password: 'Admin@123', role: 'ADMIN' } }));
await ok('GET /users (paginated)', () => req('GET', '/users?page=1&limit=10', { headers: auth() }));
await ok('GET /users?role=BRANCH_MANAGER', () => req('GET', '/users?role=BRANCH_MANAGER', { headers: auth() }));
await ok('GET /users?search=Xian', () => req('GET', '/users?search=Xian', { headers: auth() }));
await ok('GET /users/1', () => req('GET', '/users/1', { headers: auth() }));
await ok('PUT /users/2', () => req('PUT', '/users/2', { headers: auth(), body: { name: 'Updated Name' } }));
// Reactivate user 2 (admin) in case a previous run left it deactivated
await req('PATCH', '/users/2/status', { headers: auth(), body: { isActive: true } });
// Create a dedicated user for deactivation/status test, then deactivate it
await test('Create temp user for deactivation test', async () => {
  const { status, body } = await req('POST', '/users', { headers: auth(), body: { name: 'Temp Deactivate Test', email: `deactest${Date.now()}@x-grouprestaurant.com`, password: 'Test@1234', role: 'BRANCH_MANAGER', branchId: 1 } });
  if (status !== 201) return { status: 'fail', error: `Expected 201, got ${status}` };
  tokens.TEMP_USER_ID = body.data.id;
  return { status: 'ok' };
});
await ok('PATCH temp user/status (deactivate)', () => req('PATCH', `/users/${tokens.TEMP_USER_ID}/status`, { headers: auth(), body: { isActive: false } }));
await ok('PATCH temp user/status (reactivate)', () => req('PATCH', `/users/${tokens.TEMP_USER_ID}/status`, { headers: auth(), body: { isActive: true } }));
await status('DELETE /users/99999 — 404', 404, () => req('DELETE', '/users/99999', { headers: auth() }));
await status('Branch Manager cannot GET /users — 403', 403, () => req('GET', '/users', { headers: bmAuth() }));

// ── 6. DASHBOARD ──
console.log('\n📋 6. Dashboard\n');
await ok('GET /dashboard/summary (Admin)', () => req('GET', '/dashboard/summary', { headers: auth() }));
await ok('GET /dashboard/summary (BM)', () => req('GET', '/dashboard/summary', { headers: bmAuth() }));
await ok('GET /dashboard/recent-feedback', () => req('GET', '/dashboard/recent-feedback', { headers: auth() }));
await ok('GET /dashboard/branch-ranking (Admin)', () => req('GET', '/dashboard/branch-ranking', { headers: auth() }));
await status('GET /dashboard/branch-ranking (BM) — 403', 403, () => req('GET', '/dashboard/branch-ranking', { headers: bmAuth() }));
await ok('GET /dashboard/negative-feedback', () => req('GET', '/dashboard/negative-feedback', { headers: auth() }));

// ── 7. ANALYTICS ──
console.log('\n📋 7. Analytics\n');
await ok('GET /analytics/ratings', () => req('GET', '/analytics/ratings', { headers: auth() }));
await ok('GET /analytics/branches (Admin)', () => req('GET', '/analytics/branches', { headers: auth() }));
await status('GET /analytics/branches (BM) — 403', 403, () => req('GET', '/analytics/branches', { headers: bmAuth() }));
await ok('GET /analytics/monthly', () => req('GET', '/analytics/monthly', { headers: auth() }));
await ok('GET /analytics/satisfaction', () => req('GET', '/analytics/satisfaction', { headers: auth() }));

// ── 8. REPORTS ──
console.log('\n📋 8. Reports\n');
await ok('GET /reports/daily', () => req('GET', '/reports/daily', { headers: auth() }));
await ok('GET /reports/weekly', () => req('GET', '/reports/weekly', { headers: auth() }));
await ok('GET /reports/monthly', () => req('GET', '/reports/monthly', { headers: auth() }));
await ok('GET /reports/branch?branchId=1', () => req('GET', '/reports/branch?branchId=1', { headers: auth() }));
await ok('GET /reports/branch (BM scoped)', () => req('GET', '/reports/branch', { headers: bmAuth() }));
await ok('GET /reports/export/excel', () => req('GET', '/reports/export/excel', { headers: auth() }));
await ok('GET /reports/export/excel?startDate..endDate', () => req('GET', '/reports/export/excel?startDate=2026-01-01&endDate=2026-07-11', { headers: auth() }));
await ok('GET /reports/export/excel (BM)', () => req('GET', '/reports/export/excel', { headers: bmAuth() }));
await ok('GET /reports/export/pdf', () => req('GET', '/reports/export/pdf', { headers: auth() }));

// ── 9. SETTINGS ──
console.log('\n📋 9. Settings\n');
await ok('GET /settings (public)', () => req('GET', '/settings'));
await ok('PUT /settings (Super Admin)', () => req('PUT', '/settings', { headers: { Authorization: `Bearer ${tokens.SUPER_ADMIN}` }, body: { company_name: 'X-Group Restaurants Ltd.', contact_phone: '01900000000' } }));
// Fresh admin login for settings test (ensures token is valid)
await test('Fresh admin login for settings test', async () => {
  const { status, body } = await req('POST', '/auth/login', { body: { email: 'admin@x-grouprestaurant.com', password: 'Admin@123' } });
  if (status !== 200) return { status: 'fail', error: `Admin login failed: ${status}` };
  tokens.ADMIN = body.data.accessToken;
  return { status: 'ok' };
});
await status('PUT /settings (Admin) — 403', 403, () => req('PUT', '/settings', { headers: { Authorization: `Bearer ${tokens.ADMIN}` }, body: { company_name: 'X' } }));
await status('PUT /settings (BM) — 403', 403, () => req('PUT', '/settings', { headers: { Authorization: `Bearer ${tokens.BRANCH_MANAGER}` }, body: { company_name: 'X' } }));

// ── 10. EDGE CASES ──
console.log('\n📋 10. Edge Cases\n');
await status('GET /nonexistent — 404', 404, () => req('GET', '/nonexistent-endpoint'));

// ── SUMMARY ──
console.log('\n========================================');
console.log('  TEST RESULTS');
console.log('========================================');
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}`);
console.log(`  📊 Total:  ${passed + failed}`);
console.log('========================================\n');

if (errors.length > 0) {
  console.log('Failed tests:');
  errors.forEach(e => console.log(`  ❌ ${e.name}: ${e.error}`));
  console.log();
  process.exit(1);
}
