/**
 * Adds the signature-provider columns introduced after the module migration was
 * first applied. Additive and idempotent (each column is checked against
 * `information_schema` first), so it is safe to run more than once.
 *
 * MariaDB has no `ADD COLUMN IF NOT EXISTS`, hence the explicit check.
 */
import { createSeedClient, runScript } from "./seed-utils";

async function columnExists(prisma: ReturnType<typeof createSeedClient>, table: string, column: string) {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    table,
    column,
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function tableExists(prisma: ReturnType<typeof createSeedClient>, table: string) {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM information_schema.TABLES " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return (rows[0]?.count ?? 0) > 0;
}

runScript("🧩 Adding signature provider columns", async (prisma) => {
  if (!(await tableExists(prisma, "signature_placements"))) {
    console.log("  · signature_placements does not exist yet — run db:deploy first");
    return;
  }

  if (!(await columnExists(prisma, "users", "signature_provider"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `users` ADD COLUMN `signature_provider` VARCHAR(191) NULL",
    );
    console.log("  ✓ Added users.signature_provider");
  } else {
    console.log("  · users.signature_provider already present");
  }

  if (!(await columnExists(prisma, "signature_placements", "signature_provider"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `signature_placements` ADD COLUMN `signature_provider` VARCHAR(191) NOT NULL DEFAULT 'LOCAL_SECURE'",
    );
    console.log("  ✓ Added signature_placements.signature_provider");
  } else {
    console.log("  · signature_placements.signature_provider already present");
  }

  // Backfill: any user whose signature was stored before this column existed.
  const patched = await prisma.$executeRawUnsafe(
    "UPDATE `users` SET `signature_provider` = 'LOCAL_SECURE' " +
      "WHERE `signature_asset_id` IS NOT NULL AND `signature_provider` IS NULL",
  );
  console.log(`  ✓ Backfilled ${patched} user signature provider(s)`);
});
