/**
 * Read-only inspection of the `users` table.
 *
 * Used to plan the corporate user import safely:
 *   - confirm the three existing accounts (MD / Director / COO) and their ids
 *   - detect name and email collisions before any write
 *   - record the current row count so data loss can be proven afterwards
 *
 * Makes no writes.
 *
 *   npx tsx scripts/inspect-users.ts
 */
import { createSeedClient, runScript } from "../prisma/seed-utils";

runScript("🔍 User table inspection (read-only)", async (prisma) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      branchId: true,
      isActive: true,
      isDeleted: true,
      signatureUrl: true,
      signatureAssetId: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });

  console.log(`  Total rows: ${users.length}`);
  console.log(
    `  Active: ${users.filter((u) => u.isActive && !u.isDeleted).length} · ` +
      `deleted: ${users.filter((u) => u.isDeleted).length} · ` +
      `with signature: ${users.filter((u) => u.signatureUrl || u.signatureAssetId).length}\n`,
  );

  console.log("  id  role             branch  flags  signature  name / email");
  console.log("  ──  ───────────────  ──────  ─────  ─────────  ────────────────────────────");
  for (const u of users) {
    const flags = `${u.isDeleted ? "DEL" : "   "}${u.isActive ? "act" : "off"}`;
    const sig = u.signatureUrl || u.signatureAssetId ? "yes" : " - ";
    console.log(
      `  ${String(u.id).padStart(2)}  ${u.role.padEnd(15)}  ${String(u.branchId ?? "-").padStart(5)}  ${flags}  ${sig.padEnd(9)}  ${u.name} <${u.email}>`,
    );
  }

  // Collision probes for the import set.
  const TARGET_NAMES = [
    "Jashim Uddin Ahmed",
    "Abid Uddin Ahmed",
    "Mohammed Jahangir Alam",
    "Md. Zilhaj Pervez",
    "Shaker ull Alam",
    "Md. Habibur Rahman",
    "Muhammad Al Mamun",
    "Md Reasad Ahmed",
    "Md. Mehedi Hasan Momin",
    "Md Arman Ali",
    "Md. Mujibur Rahaman",
    "Md. Abu Wahid",
    "Md. Shohel Miah",
  ];

  const normalised = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const existingByName = new Map(users.map((u) => [normalised(u.name), u]));

  console.log("\n  Match probe against the import set:");
  for (const name of TARGET_NAMES) {
    const hit = existingByName.get(normalised(name));
    console.log(
      `    ${hit ? "MATCH  " : "new    "} ${name}${hit ? `  → id ${hit.id} (${hit.role}) <${hit.email}>` : ""}`,
    );
  }

  const emails = users.map((u) => u.email.toLowerCase());
  console.log(`\n  Existing unique emails: ${new Set(emails).size} of ${emails.length}`);
});
