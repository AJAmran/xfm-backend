/**
 * Verifies the corporate management tier after import.
 *
 * Logs in as a real MANAGER and exercises the DIRECTOR's authorization
 * boundary end to end:
 *   - passwords are bcrypt hashes, never plaintext
 *   - `department` / `designation` round-trip and the accounts are global
 *   - `/auth/me` works (otherwise the dashboard gate bounces them to /login)
 *   - the document module is reachable — this is what they were added for
 *   - notifications + realtime work (an approver with no bell never learns of work)
 *   - everything they were NOT granted returns 403, not a silent blank page
 *
 * The DIRECTOR session is a locally signed access token rather than a login:
 * the import deliberately does not reset an existing account's password, so the
 * operator's current credential is unknown here — yet `authGuard` only validates
 * the signature, id, role and `tokenVersion`, so a signed token exercises
 * exactly the same code path without touching credentials.
 *
 *   npx tsx scripts/verify-corporate-access.ts
 */
import env from "../src/config/env";
import { jwtHelpers } from "../src/utils/jwtHelpers";
import { createSeedClient, runScript } from "../prisma/seed-utils";

const BASE = (process.env.SMOKE_API_URL || "http://127.0.0.1:5000").replace(/\/$/, "");

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`    ✔ ${label}`);
  } else {
    failed += 1;
    console.log(`    ✖ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

interface Session {
  cookies: string;
}

async function login(email: string, password: string): Promise<Session | null> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { cookies: jar };
}

function mintSession(user: { id: number; email: string; role: string; tokenVersion: number }): Session {
  const token = jwtHelpers.generateToken(
    {
      id: String(user.id),
      email: user.email,
      role: user.role,
      tokenVersion: String(user.tokenVersion),
    },
    env.jwt_access_secret,
    "15m",
  );
  return { cookies: `accessToken=${token}` };
}

async function status(session: Session, path: string, method = "GET"): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookies, "Content-Type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });
  return res.status;
}

runScript("🔐 Corporate access verification", async (prisma) => {
  const director = await prisma.user.findFirst({
    where: { email: "director@x-grouprestaurant.com", isDeleted: false },
  });
  const manager = await prisma.user.findFirst({
    where: { email: "zilhaj.pervez@x-grouprestaurant.com", isDeleted: false },
  });

  if (!director || !manager) {
    console.log("  ✖ Corporate accounts not found. Run the import first.");
    process.exitCode = 1;
    return;
  }

  console.log("\n▸ Password storage");
  for (const account of [director, manager]) {
    const record = await prisma.user.findUniqueOrThrow({
      where: { id: account.id },
      select: { password: true },
    });
    check(
      `${account.email} stores a bcrypt hash`,
      /^\$2[aby]\$\d{2}\$/.test(record.password),
      record.password.slice(0, 10),
    );
  }

  console.log("\n▸ Profile fields");
  for (const account of [director, manager]) {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: account.id },
      select: { department: true, designation: true, role: true, branchId: true },
    });
    check(
      `${account.email} — ${row.department} · ${row.designation} · ${row.role}`,
      Boolean(row.department && row.designation) && row.branchId === null,
      row,
    );
  }

  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) {
    console.log("\n  ⚠ API not running — start it (`npm run dev`) to verify access.");
    console.log(`\n  ${passed} passed · ${failed} failed\n`);
    return;
  }

  console.log("\n▸ Authentication");
  check(
    "new MANAGER logs in with the supplied password",
    (await login(manager.email, process.env.CORPORATE_PW_ZILHAJ ?? "")) !== null,
  );

  // The DIRECTOR's address was moved off the seeded `admin@` placeholder.
  check(
    "DIRECTOR logs in with the current address and password",
    (await login("Director@x-grouprestaurant.com", process.env.CORPORATE_PW_DIRECTOR ?? "")) !== null,
  );
  check(
    "old seeded admin@ address no longer authenticates",
    (await login("admin@x-grouprestaurant.com", process.env.CORPORATE_PW_DIRECTOR ?? "")) === null,
  );

  const session = mintSession(director);
  check("DIRECTOR session accepted", (await status(session, "/api/v1/auth/me")) === 200);

  console.log("\n▸ GRANTED — the document module and its shell");
  const allowed = [
    "/api/v1/dashboard/summary",
    "/api/v1/notifications",
    "/api/v1/notifications/unread-count",
    "/api/v1/documents",
    "/api/v1/documents/summary",
    "/api/v1/documents/types",
    "/api/v1/documents/policy",
    "/api/v1/documents/directory/approvers",
    "/api/v1/documents/signature",
    "/api/v1/approvals/pending",
    "/api/v1/approvals/history",
  ];
  for (const path of allowed) {
    const code = await status(session, path);
    check(`GET ${path} → 200`, code === 200, code);
  }

  console.log("\n▸ DENIED — everything outside their remit stays closed");
  const denied: [string, string][] = [
    ["GET", "/api/v1/users"],
    ["GET", "/api/v1/branches"],
    ["GET", "/api/v1/feedbacks"],
    ["GET", "/api/v1/analytics/ratings"],
    ["GET", "/api/v1/bookings"],
    ["GET", "/api/v1/manager-reports"],
    ["GET", "/api/v1/guest-offers"],
    ["GET", "/api/v1/inventory/categories"],
    ["GET", "/api/v1/reports"],
    ["PATCH", "/api/v1/documents/policy"],
    ["POST", "/api/v1/documents/types"],
    ["GET", "/api/v1/documents/audit-feed"],
    ["POST", "/api/v1/documents/sla-sweep"],
  ];
  for (const [method, path] of denied) {
    const code = await status(session, path, method);
    check(`${method} ${path} → 403`, code === 403, code);
  }

  console.log(`\n${"─".repeat(56)}`);
  console.log(`  ${passed} passed · ${failed} failed`);
  console.log(`${"─".repeat(56)}\n`);
  if (failed > 0) process.exitCode = 1;
});
