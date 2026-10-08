/**
 * Data-integrity audit for the X-Group feedback database.
 *
 * Read-only. Answers the questions worth asking after any provisioning or
 * migration run:
 *
 *   - are the roles distributed sensibly, and does any test fixture still hold
 *     a privileged one?
 *   - are all passwords bcrypt, and is any hash shared by two accounts?
 *   - do head-office roles carry a department and designation, and are they
 *     global rather than branch-scoped?
 *   - are emails unique (case-insensitively, since the column is `_ci`),
 *     well-formed, and free of duplicate privileged addresses?
 *   - does every signature asset have a display URL to render?
 *   - is there orphaned feedback or a user left on a deleted branch?
 *
 * Every line is `[OK]` when the count is zero and `[WARN]` otherwise, so the
 * output is greppable: `npx tsx scripts/audit-integrity.ts | findstr WARN`.
 *
 *   npx tsx scripts/audit-integrity.ts
 */
import { createSeedClient, runScript } from "../prisma/seed-utils";

const flag = (label: string, count: number, detail: string) => {
  const mark = count === 0 ? "OK  " : "WARN";
  console.log(`  [${mark}] ${label.padEnd(46)} ${String(count).padStart(3)}  ${detail}`);
};

runScript("🔍 Data integrity audit", async (prisma) => {
  console.log("\n── Role distribution (active accounts) ──");
  const roles = await prisma.user.groupBy({
    by: ["role"],
    where: { isDeleted: false },
    _count: { _all: true },
  });
  for (const r of roles.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`      ${r.role.padEnd(16)} ${r._count._all}`);
  }

  console.log("\n── Account hygiene ──");
  const testLike = await prisma.user.findMany({
    where: { isDeleted: false, OR: [{ email: { contains: "test" } }, { email: { contains: "optest" } }, { name: { contains: "OpsTest" } }] },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  flag("accounts that look like test fixtures", testLike.length, testLike.map((u) => `#${u.id} ${u.email}`).join(", ") || "none");

  const inactive = await prisma.user.count({ where: { isDeleted: false, isActive: false } });
  flag("active rows but isActive=false", inactive, "cannot log in, still listed");

  const softDeleted = await prisma.user.count({ where: { isDeleted: true } });
  console.log(`      soft-deleted accounts: ${softDeleted} (retained by policy)`);

  console.log("\n── Credential hygiene ──");
  const weak = await prisma.user.findMany({
    where: { isDeleted: false },
    select: { id: true, email: true, password: true },
  });
  const notBcrypt = weak.filter((u) => !/^\$2[aby]\$\d{2}\$/.test(u.password));
  flag("passwords not bcrypt", notBcrypt.length, notBcrypt.map((u) => `#${u.id}`).join(", ") || "none");

  // A seeded default reused by several accounts is a shared-credential problem.
  const byHash = new Map<string, number[]>();
  for (const u of weak) {
    const list = byHash.get(u.password) ?? [];
    list.push(u.id);
    byHash.set(u.password, list);
  }
  const shared = [...byHash.entries()].filter(([, ids]) => ids.length > 1);
  flag("password hashes shared by >1 account", shared.length, shared.map(([, ids]) => ids.map((i) => `#${i}`).join("+")).join(", ") || "none");

  console.log("\n── Profile completeness ──");
  const execs = await prisma.user.findMany({
    where: { isDeleted: false, role: { in: ["SUPER_ADMIN", "MD", "COO", "DIRECTOR", "ADMIN", "MANAGER"] } },
    select: { id: true, name: true, email: true, role: true, department: true, designation: true, signatureUrl: true, branchId: true },
    orderBy: { id: "asc" },
  });
  const missingProfile = execs.filter((u) => !u.department || !u.designation);
  flag("head-office roles missing dept/designation", missingProfile.length, missingProfile.map((u) => `#${u.id}`).join(", ") || "none");
  const branchScopedExec = execs.filter((u) => u.branchId !== null);
  flag("head-office roles bound to a branch", branchScopedExec.length, branchScopedExec.map((u) => `#${u.id}`).join(", ") || "none");

  console.log("\n── Email integrity ──");
  const all = await prisma.user.findMany({ select: { email: true } });
  const emails = all.map((u) => u.email.trim().toLowerCase());
  flag("duplicate emails (case-insensitive)", emails.length - new Set(emails).size, "unique index is case-sensitive; collation is _ci");
  const badFormat = all.filter((u) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email));
  flag("malformed email addresses", badFormat.length, badFormat.map((u) => u.email).join(", ") || "none");
  const reserved = all.filter((u) => /^(admin|superadmin|md|coo)@/.test(u.email));
  flag("privileged well-known addresses in use", reserved.length, reserved.map((u) => u.email).join(", ") || "none");

  console.log("\n── Signature assets ──");
  const sigUsers = await prisma.user.count({ where: { isDeleted: false, signatureUrl: { not: null } } });
  console.log(`      accounts with a signature URL: ${sigUsers}`);
  const sigDocs = await prisma.signaturePlacement.count();
  const sigProv = await prisma.user.count({ where: { signatureProvider: { not: null } } });
  const sigNoUrl = await prisma.user.count({ where: { signatureProvider: { not: null }, signatureUrl: null } });
  console.log(`      signature placements frozen: ${sigDocs}`);
  console.log(`      accounts with a signature provider asset: ${sigProv}`);
  flag("signature asset without a display URL", sigNoUrl, "stamp would render blank");

  console.log("\n── Referential integrity ──");
  const orphanFeedback = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    "SELECT COUNT(*) AS n FROM `guest_feedbacks` WHERE `branch_id` IS NULL",
  );
  flag("feedback rows with no branch", Number(orphanFeedback[0]?.n ?? 0), "FK should prevent");
  const orphanUsers = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    "SELECT COUNT(*) AS n FROM `users` u JOIN `branches` b ON b.id = u.branch_id WHERE u.is_deleted = 0 AND b.is_deleted = 1",
  );
  flag("active users on a deleted branch", Number(orphanUsers[0]?.n ?? 0), "cannot be scoped safely");
});