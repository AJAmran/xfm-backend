/**
 * Verifies that the live database matches the module migration for the pieces
 * that were added after the migration was first applied (`signature_provider`).
 *
 * A clean-room deploy gets these columns from the migration itself; this script
 * exists so the already-migrated database can be confirmed equivalent, and so
 * future schema changes are checked the same way.
 *
 *   npx tsx scripts/audit-schema-drift.ts
 */
import { createSeedClient, runScript } from "../prisma/seed-utils";

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
}

runScript("🔍 Schema drift check (document module)", async (prisma) => {
  const columns = await prisma.$queryRawUnsafe<ColumnRow[]>(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT " +
      "FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND (" +
      "  (TABLE_NAME = 'signature_placements' AND COLUMN_NAME = 'signature_provider') OR " +
      "  (TABLE_NAME = 'users' AND COLUMN_NAME IN ('signature_provider', 'signature_asset_id')) OR " +
      "  (TABLE_NAME = 'system_settings' AND COLUMN_NAME = 'value')" +
      ") ORDER BY TABLE_NAME, COLUMN_NAME",
  );

  console.log("  Column state:");
  for (const c of columns) {
    console.log(
      `    ${c.TABLE_NAME}.${c.COLUMN_NAME.padEnd(22)} ${c.COLUMN_TYPE.padEnd(12)} nullable=${c.IS_NULLABLE} default=${c.COLUMN_DEFAULT ?? "NULL"}`,
    );
  }

  // The database-level guarantee that a step can never be decided twice.
  const uniqueIdx = await prisma.$queryRawUnsafe<{ INDEX_NAME: string; COLUMN_NAME: string }[]>(
    "SELECT INDEX_NAME, COLUMN_NAME FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'approvals' AND NON_UNIQUE = 0 " +
      "ORDER BY INDEX_NAME",
  );
  console.log("\n  Unique indexes on `approvals` (concurrency guarantee):");
  for (const i of uniqueIdx) console.log(`    ${i.INDEX_NAME} (${i.COLUMN_NAME})`);

  const stepUnique = uniqueIdx.some((i) => i.COLUMN_NAME === "workflow_step_id");
  console.log(`\n  approvals.workflow_step_id is UNIQUE: ${stepUnique ? "✓" : "✖"}`);

  const placement = columns.find(
    (c) => c.TABLE_NAME === "signature_placements" && c.COLUMN_NAME === "signature_provider",
  );
  const notNull = placement?.IS_NULLABLE === "NO";
  console.log(`  signature_placements.signature_provider NOT NULL: ${notNull ? "✓" : "✖"}`);

  const settingsValue = columns.find(
    (c) => c.TABLE_NAME === "system_settings" && c.COLUMN_NAME === "value",
  );
  console.log(`  system_settings.value is TEXT: ${settingsValue?.COLUMN_TYPE === "text" ? "✓" : "✖"}`);

  const problems = [
    !stepUnique ? "approvals.workflow_step_id must be UNIQUE" : null,
    !notNull ? "signature_placements.signature_provider must be NOT NULL" : null,
    settingsValue?.COLUMN_TYPE === "text" ? null : "system_settings.value must be TEXT",
  ].filter(Boolean);

  if (problems.length) {
    console.log(`\n  ✖ Drift detected:\n${problems.map((p) => `    - ${p}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  ✓ No drift between the live database and the module schema.");
});
