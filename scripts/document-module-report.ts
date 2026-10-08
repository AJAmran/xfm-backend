/**
 * Read-only health report for the document module.
 *
 * Prints row counts and workflow distribution so a reviewer can confirm the
 * module is populated and — critically — that nothing outside it was disturbed.
 * Makes no writes of any kind.
 *
 *   npx tsx scripts/document-module-report.ts
 */
import { createSeedClient, runScript } from "../prisma/seed-utils";

runScript("📊 Document module report", async (prisma) => {
  const [users, branches, feedback, documents, steps, approvals, placements, auditRows, types] =
    await Promise.all([
      prisma.user.count({ where: { isDeleted: false } }),
      prisma.branch.count(),
      prisma.guestFeedback.count(),
      prisma.document.count({ where: { isDeleted: false } }),
      prisma.workflowStep.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.approval.groupBy({ by: ["action"], _count: { _all: true } }),
      prisma.signaturePlacement.count(),
      prisma.documentAuditLog.count(),
      prisma.documentType.count({ where: { isDeleted: false } }),
    ]);

  const byStatus = await prisma.document.groupBy({
    by: ["status"],
    where: { isDeleted: false },
    _count: { _all: true },
  });

  const smokeUsers = await prisma.user.count({
    where: { email: { contains: "smoke-" } },
  });

  console.log("  Existing operational data (must be untouched):");
  console.log(`    branches      : ${branches}`);
  console.log(`    users         : ${users}`);
  console.log(`    guestFeedback : ${feedback}`);

  console.log("\n  Document module:");
  console.log(`    documentTypes : ${types}`);
  console.log(`    documents     : ${documents}`);
  console.log(`      by status   : ${byStatus.map((s) => `${s.status}=${s._count._all}`).join(", ") || "—"}`);
  console.log(`    workflowSteps : ${steps.map((s) => `${s.status}=${s._count._all}`).join(", ") || "—"}`);
  console.log(`    approvals     : ${approvals.map((a) => `${a.action}=${a._count._all}`).join(", ") || "—"}`);
  console.log(`    signatures    : ${placements} placement(s)`);
  console.log(`    auditRows     : ${auditRows}`);

  console.log("\n  Hygiene:");
  console.log(`    leftover smoke-test users : ${smokeUsers} ${smokeUsers === 0 ? "✓" : "✖"}`);
});
