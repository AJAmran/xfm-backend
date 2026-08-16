/**
 * Verifies the expected database indexes are actually present on the
 * connected server. Run with: npx tsx scripts/check-indexes.ts
 *
 * Analytics/aggregation endpoints depend on the guest_feedbacks compound
 * indexes — if any are missing, dashboard queries degrade to full scans.
 */
import { prisma } from "../src/lib/prisma";

type IndexRow = { table_name: string; index_name: string; columns: string; non_unique: number };

const EXPECTED: Record<string, string[]> = {
  guest_feedbacks: [
    "feedback_id (unique)",
    "branch_id",
    "submitted_at",
    "overall_rating",
    "branch_id, submitted_at",
    "branch_id, overall_rating",
    "overall_rating, submitted_at",
  ],
  users: ["email"],
};

async function main() {
  const rows = await prisma.$queryRaw<IndexRow[]>`
    SELECT TABLE_NAME AS table_name,
           INDEX_NAME AS index_name,
           GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns,
           NON_UNIQUE AS non_unique
    FROM information_schema.statistics
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('guest_feedbacks', 'users', 'branches')
    GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
    ORDER BY TABLE_NAME, INDEX_NAME`;

  const byTable = new Map<string, Set<string>>();
  for (const r of rows) {
    // Normalize the column list (GROUP_CONCAT joins with commas, no spaces).
    const normalizedColumns = r.columns.replace(/,/g, ", ");
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
    const set = byTable.get(r.table_name)!;
    set.add(normalizedColumns);
    if (r.non_unique === 0) set.add(`${normalizedColumns} (unique)`);
    console.log(`  ${r.table_name}.${r.index_name}: (${normalizedColumns})${r.non_unique === 0 ? " [unique]" : ""}`);
  }

  console.log("\n=== Expected index coverage ===");
  let allOk = true;
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const actual = byTable.get(table) ?? new Set<string>();
    for (const want of expected) {
      const ok = actual.has(want);
      if (!ok) allOk = false;
      console.log(`  ${table}: ${ok ? "OK  " : "MISS"} ${want}`);
    }
  }
  console.log(allOk ? "\nAll expected indexes present." : "\nSome expected indexes are MISSING.");
}

main().finally(() => prisma.$disconnect());
