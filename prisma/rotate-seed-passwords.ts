/**
 * Hardening script: rotates the passwords of well-known seed accounts.
 * It does NOT wipe any data. Run: npx tsx prisma/rotate-seed-passwords.ts
 *
 * Passwords come from env if set, otherwise they are generated and printed.
 * Existing sessions are revoked via tokenVersion.
 */
import { Role } from "../generated/prisma/enums";
import {
  KNOWN_ACCOUNTS,
  SEED_MANAGER_ENV_KEY,
  hashPassword,
  resolveSeedPassword,
  runScript,
} from "./seed-utils";

const MANAGER_EMAIL_LOCALS = [
  "xian",
  "xenial",
  "xiamen",
  "golden.chm",
  "xindian",
  "xinxian.dhan",
  "4seasons",
  "xinxian.mirpur",
  "chungwah",
  "xinxian.uttara",
  "shimanto",
  "xinxian.mirpur1",
  "zamzam",
  "zamzam.mirpur",
  "4season",
];

async function main() {
  await runScript("🔐 Rotating seed account passwords...", async (prisma) => {
    const accounts = [
      ...KNOWN_ACCOUNTS.map((a) => ({
        email: a.email,
        role: a.role,
        envKey: a.envKey,
        label: a.label,
        fallback: a.fallbackPassword,
      })),
      ...MANAGER_EMAIL_LOCALS.map((local) => ({
        email: `${local}@x-grouprestaurant.com`,
        role: Role.BRANCH_MANAGER,
        envKey: SEED_MANAGER_ENV_KEY,
        label: `Manager (${local})`,
        fallback: undefined as string | undefined,
      })),
    ];

    let rotated = 0;
    for (const account of accounts) {
      const existing = await prisma.user.findFirst({
        where: { email: account.email, isDeleted: false },
        select: { id: true },
      });
      if (!existing) {
        console.log(`  − ${account.email} — account not found, skipped`);
        continue;
      }

      const password = resolveSeedPassword(account.envKey, account.label, account.fallback);
      const hashed = await hashPassword(password);
      await prisma.user.update({
        where: { id: existing.id },
        data: { password: hashed, tokenVersion: { increment: 1 } },
      });

      console.log(`  ✓ ${account.email} rotated`);
      rotated += 1;
    }

    console.log(`\n✅ Rotated ${rotated} account(s). Existing sessions have been revoked.`);
  });
}

main();
