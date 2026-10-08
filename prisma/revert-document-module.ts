/**
 * Cleanup helper for a partially-applied document-module migration.
 *
 * Drop every object the module owns (children first) and remove the columns it
 * added to pre-existing tables, so the corrected migration can be re-applied
 * from a clean slate. Only touches objects created by
 * `20261001000000_add_document_approval_module` — no operational data is lost.
 */
import { createSeedClient, runScript } from "./seed-utils";

const TABLES_IN_DELETE_ORDER = [
  "document_audit_logs",
  "signature_placements",
  "approvals",
  "workflow_steps",
  "workflow_instances",
  "document_files",
  "document_versions",
  "documents",
  "document_types",
];

runScript("🧹 Reverting partial document-module migration", async (prisma) => {
  for (const table of TABLES_IN_DELETE_ORDER) {
    try {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS \`${table}\``);
      console.log(`  ✓ Dropped ${table}`);
    } catch (error) {
      console.warn(`  ⚠ Could not drop ${table}:`, error instanceof Error ? error.message : error);
    }
  }

  // Remove the foreign keys before the columns they depend on.
  for (const constraint of [
    "notifications_documentId_fkey",
    "notifications_recipientUserId_fkey",
  ]) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE \`notifications\` DROP FOREIGN KEY \`${constraint}\``);
      console.log(`  ✓ Dropped FK ${constraint}`);
    } catch {
      // Already absent — nothing to do.
    }
  }

  for (const index of [
    "notifications_documentId_createdAt_idx",
    "notifications_recipientUserId_read_createdAt_idx",
  ]) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE \`notifications\` DROP INDEX \`${index}\``);
      console.log(`  ✓ Dropped index ${index}`);
    } catch {
      // Already absent.
    }
  }

  for (const column of ["document_id", "recipient_user_id"]) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE \`notifications\` DROP COLUMN \`${column}\``);
      console.log(`  ✓ Dropped notifications.${column}`);
    } catch {
      // Already absent.
    }
  }

  try {
    await prisma.$executeRawUnsafe("ALTER TABLE `users` DROP COLUMN `signature_asset_id`");
    console.log("  ✓ Dropped users.signature_asset_id");
  } catch {
    console.log("  · users.signature_asset_id already absent");
  }

  // Restore the original notification enum so nothing else depends on it.
  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `notifications` MODIFY COLUMN `type` ENUM('MANAGER_REPORT_SUBMITTED','INVENTORY_STATEMENT_SUBMITTED') NOT NULL",
    );
    console.log("  ✓ Restored notifications.type enum");
  } catch {
    console.log("  · notifications.type already at its original definition");
  }
});