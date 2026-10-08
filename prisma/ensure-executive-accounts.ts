import { KNOWN_ACCOUNTS, hashPassword, resolveSeedPassword, runScript } from "./seed-utils";

/**
 * Ensures every well-known account exists with the right profile.
 *
 * Two behaviours, deliberately asymmetric:
 *
 * - **Create** — provisions the account with its resolved password
 *   (`<envKey>` from `.env`, otherwise the registry fallback). This is how
 *   `admin@` is brought back after the Director import consumed that address.
 * - **Update** — refreshes the profile only (name, role, department,
 *   designation, signature, active flag) and leaves `password` alone.
 *
 * Rotation is a separate, explicit act (`npm run passwords:rotate`), so a
 * routine "make sure these accounts exist" run can never silently change a
 * credential somebody is already using.
 */
async function main() {
  await runScript("🔐 Ensuring well-known accounts...", async (prisma) => {
    let created = 0;
    let updated = 0;

    for (const a of KNOWN_ACCOUNTS) {
      const existing = await prisma.user.findUnique({
        where: { email: a.email },
        select: { id: true, role: true },
      });

      const profile = {
        name: a.name,
        role: a.role,
        department: a.department ?? null,
        designation: a.designation ?? null,
        // Signature URLs are only written when the registry carries one.
        // `?? null` here would silently erase an existing signature — which
        // disables signing outright, because the sign flow requires BOTH
        // `signatureAssetId` and `signatureUrl` to be present.
        ...(a.signatureUrl ? { signatureUrl: a.signatureUrl } : {}),
      };

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { ...profile, isActive: true, isDeleted: false },
        });
        updated += 1;
        console.log(
          `  ✓ #${String(existing.id).padStart(3)} ${a.role.padEnd(14)} ${a.email.padEnd(38)} ` +
            `profile refreshed${existing.role === a.role ? "" : ` (role ${existing.role} → ${a.role})`}`,
        );
        continue;
      }

      const password = await hashPassword(resolveSeedPassword(a.envKey, a.label, a.fallbackPassword));
      const user = await prisma.user.create({
        data: {
          ...profile,
          email: a.email,
          password,
          isActive: true,
          // Well-known accounts are global by definition, and the registry
          // omits `branchId` — `users.branch_id` is nullable, so it defaults to
          // NULL here rather than being assignable from the registry.
        },
        select: { id: true },
      });
      created += 1;
      console.log(`  ✔ #${String(user.id).padStart(3)} ${a.role.padEnd(14)} ${a.email.padEnd(38)} created`);
    }

    console.log(
      `\n  ${created} created · ${updated} profile(s) refreshed. Existing passwords untouched.`,
    );
  });
}

main();
