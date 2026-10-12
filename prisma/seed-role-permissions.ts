import { ROLE_PERMISSIONS } from "../src/lib/permission-catalog";
import { runScript } from "./seed-utils";

// Mirrors ROLE_PERMISSIONS_SETTINGS_KEY in src/lib/permissions.ts. Kept as a
// literal so this script never pulls the app's prisma singleton (seed scripts
// use their own client from seed-utils).
const ROLE_PERMISSIONS_SETTINGS_KEY = "role_permissions";

/**
 * Seeds the `role_permissions` config row from `src/lib/permission-catalog.ts`.
 *
 * Idempotent: does nothing when the row already exists (admin edits made
 * through the Roles UI must never be clobbered by a re-run). Pass `--force`
 * to deliberately reset the row back to the catalog defaults.
 *
 *   npx tsx prisma/seed-role-permissions.ts [--force]
 */

const FORCE = process.argv.includes("--force");

runScript("🔐 Role permissions seed", async (prisma) => {
  const value = JSON.stringify(ROLE_PERMISSIONS, null, 2);
  const existing = await prisma.systemSetting.findUnique({
    where: { key: ROLE_PERMISSIONS_SETTINGS_KEY },
    select: { id: true },
  });

  if (!existing) {
    await prisma.systemSetting.create({ data: { key: ROLE_PERMISSIONS_SETTINGS_KEY, value } });
    console.log(
      `  ✔ role_permissions created (${Object.keys(ROLE_PERMISSIONS).length} roles, ` +
        `${Object.values(ROLE_PERMISSIONS).reduce((n, keys) => n + keys.length, 0)} keys)`,
    );
    return;
  }

  if (!FORCE) {
    console.log("  role_permissions already present — pass --force to reset it to the catalog defaults");
    return;
  }

  await prisma.systemSetting.update({ where: { key: ROLE_PERMISSIONS_SETTINGS_KEY }, data: { value } });
  console.log("  ✔ role_permissions overwritten from the catalog (--force)");
});
