/**
 * Corporate management import.
 *
 * Adds the X-Group corporate team as GLOBAL users (no branch) with their
 * department and designation, and backfills those fields on the three
 * executive accounts that already exist.
 *
 * Guarantees:
 *   - NEVER deletes or overwrites unrelated rows.
 *   - Idempotent: re-running updates in place rather than duplicating.
 *   - Matches existing accounts by ROLE for the three executives (their seeded
 *     names are placeholders, not the real people) and by NAME for the rest.
 *   - Passwords are hashed with bcrypt and never logged or stored in clear.
 *   - Existing accounts are NOT re-passworded unless `--reset-passwords` is
 *     passed, so running this can never lock anyone out.
 *
 * Usage:
 *   npx tsx prisma/import-corporate-users.ts --dry-run   # preview only
 *   npx tsx prisma/import-corporate-users.ts             # apply
 *   npx tsx prisma/import-corporate-users.ts --reset-passwords
 */
import { Role } from "../generated/prisma/enums";
import { SALT_ROUNDS, createSeedClient, hashPassword, runScript } from "./seed-utils";
import { CORPORATE_USERS, missingCorporatePasswords } from "./corporate-users";

const DRY_RUN = process.argv.includes("--dry-run");
const RESET_PASSWORDS = process.argv.includes("--reset-passwords");

/**
 * `--reset-password-for=<email>[,<email>]` — reset the password of named
 * EXISTING accounts only, leaving everyone else's credentials untouched.
 *
 * Preferred over `--reset-passwords` when only one person needs a new
 * credential: the blanket flag re-provisions every seeded account, which can
 * lock out colleagues whose current password is already in circulation.
 */
const RESET_FOR = new Set(
  (
    process.argv
      .find((a) => a.startsWith("--reset-password-for="))
      ?.split("=")[1] ?? ""
  )
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const DOMAIN = "x-grouprestaurant.com";

/** `Md. Zilhaj Pervez` → `zilhaj.pervez` — honours the name, drops the honorific. */
function emailSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bmd\.?\s+/g, "")
    .normalize("NFKD")
    .replace(/[^a-z0-9\s.]/g, "")
    .replace(/\s+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function generatedEmail(name: string): string {
  return `${emailSlug(name)}@${DOMAIN}`;
}

/**
 * Nearest existing account for an executive.
 *
 * The three executive accounts were seeded with placeholder names, so on a
 * first run there is no user holding DIRECTOR yet — the caller therefore falls
 * back to matching the explicit `email`. Once imported, the role match keeps
 * subsequent runs stable and idempotent.
 */
async function findByRole(prisma: ReturnType<typeof createSeedClient>, role: Role) {
  // Newest-first: if a role has been assigned more than once, the most recently
  // provisioned account is the intended target.
  const rows = await prisma.user.findMany({
    where: { role, isDeleted: false },
    select: { id: true, name: true, email: true, role: true, department: true, designation: true },
    orderBy: { id: "desc" },
  });
  return rows[0] ?? null;
}

runScript(
  `🌍 Importing corporate management users${DRY_RUN ? " (DRY RUN — no writes)" : ""}`,
  async (prisma) => {
    const before = {
      users: await prisma.user.count(),
      feedback: await prisma.guestFeedback.count(),
      branches: await prisma.branch.count(),
      documents: await prisma.document.count(),
    };
    console.log(
      `  Before: users=${before.users} branches=${before.branches} feedback=${before.feedback} documents=${before.documents}\n`,
    );

    const planned: {
      action: "create" | "update";
      name: string;
      email: string;
      /** Address currently on the account, used for the change note. */
      currentEmail?: string;
      /** New address to move the account to, or null when it stays put. */
      emailChangeTo: string | null;
      role: Role;
      department: string;
      designation: string;
      id?: number;
      notes: string[];
    }[] = [];

    for (const person of CORPORATE_USERS) {
      const email = person.email?.trim() || generatedEmail(person.name);
      const notes: string[] = [];

      // 1) Executives resolve by ROLE (their seeded names are placeholders).
      let existing = person.matchByRole ? await findByRole(prisma, person.role) : null;

      // 2) Everyone else resolves by exact email, then by name.
      if (!existing) {
        existing = await prisma.user.findFirst({
          where: { email, isDeleted: false },
          select: { id: true, name: true, email: true, role: true, department: true, designation: true },
        });
      }
      if (!existing && !person.matchByRole) {
        existing = await prisma.user.findFirst({
          where: { name: person.name, isDeleted: false },
          select: { id: true, name: true, email: true, role: true, department: true, designation: true },
        });
        if (existing) notes.push("matched by name");
      }

      // 3) Collision probe: does the target email belong to someone else?
      // Probed for a new account AND for an existing account being moved to a
      // different address — the unique index would otherwise abort mid-run.
      if (!existing || existing.email.toLowerCase() !== email.toLowerCase()) {
        const emailOwner = await prisma.user.findUnique({
          where: { email },
          select: { id: true, name: true },
        });
        if (emailOwner && emailOwner.id !== existing?.id) {
          notes.push(`EMAIL COLLISION with #${emailOwner.id} ${emailOwner.name}`);
        }
      }

      const emailChangeTo =
        existing && existing.email.toLowerCase() !== email.toLowerCase() ? email : null;
      if (emailChangeTo) notes.push(`email → ${emailChangeTo}`);

      planned.push({
        action: existing ? "update" : "create",
        name: person.name,
        email,
        currentEmail: existing?.email,
        emailChangeTo,
        role: person.role,
        department: person.department,
        designation: person.designation,
        id: existing?.id,
        notes,
      });
    }

    console.log("  Plan:");
    for (const p of planned) {
      const tag = p.action === "create" ? "CREATE" : `UPDATE #${p.id}`;
      console.log(
        `    ${tag.padEnd(11)} ${p.role.padEnd(15)} ${p.name.padEnd(26)} ${p.email}` +
          (p.notes.length ? `   [${p.notes.join("; ")}]` : ""),
      );
      console.log(
        `    ${" ".padEnd(11)} ${" ".padEnd(15)} ${p.department} · ${p.designation}`,
      );
    }

    const collisions = planned.filter((p) => p.notes.some((n) => n.startsWith("EMAIL")));
    if (collisions.length) {
      console.error(
        `\n  ✖ Aborting: ${collisions.length} generated email collision(s). Set an explicit email in corporate-users.ts.`,
      );
      process.exitCode = 1;
      return;
    }

    if (DRY_RUN) {
      console.log("\n  · Dry run — nothing was written.");
      return;
    }

    // ── Credential preflight ────────────────────────────────────────────────
    // Every password lives in the environment, never in the seed source. Refuse
    // to write anything if one is missing rather than creating a login nobody
    // knows the password for.
    const missing = missingCorporatePasswords();
    if (missing.length) {
      console.error(
        `\n  ✖ Aborting: ${missing.length} password(s) not set in the environment:`,
      );
      for (const key of missing) console.error(`      - ${key}`);
      console.error(
        "    Set them in .env (git-ignored) or export them, then re-run.",
      );
      process.exitCode = 1;
      return;
    }

    // ── Apply ────────────────────────────────────────────────────────────────
    let created = 0;
    let updated = 0;
    const passwordUpdates: string[] = [];
    const emailUpdates: string[] = [];

    for (const p of planned) {
      const person = CORPORATE_USERS.find((x) => x.name === p.name)!;

      if (p.action === "create") {
        const hash = await hashPassword(process.env[person.passwordEnv]!);
        await prisma.user.create({
          data: {
            name: p.name,
            email: p.email,
            password: hash,
            role: p.role,
            branchId: null, // global scope
            department: p.department,
            designation: p.designation,
            // `signimgurl` in the source sheet maps to the EXISTING
            // `users.signature_url` column — there is deliberately no second
            // signature column. Empty in the sheet ⇒ leave null.
            signatureUrl: person.signatureImageUrl?.trim() || null,
            isActive: true,
          },
        });
        created += 1;
        continue;
      }

      // Update: profile fields only. `branchId`, `password`, `isActive`,
      // `signatureUrl` and `tokenVersion` are deliberately left untouched so a
      // running import cannot change someone's access or sign them out.
      const emailChanged =
        p.emailChangeTo !== null &&
        (p.currentEmail ?? "").toLowerCase() !== p.emailChangeTo!.toLowerCase();

      await prisma.user.update({
        where: { id: p.id },
        data: {
          name: p.name,
          role: p.role,
          department: p.department,
          designation: p.designation,
          ...(emailChanged ? { email: p.emailChangeTo! } : {}),
        },
      });
      updated += 1;
      if (emailChanged) emailUpdates.push(`#${p.id} ${p.currentEmail} → ${p.emailChangeTo}`);

      const shouldResetPassword =
        RESET_PASSWORDS || RESET_FOR.has((p.currentEmail ?? "").toLowerCase());
      if (shouldResetPassword) {
        await prisma.user.update({
          where: { id: p.id },
          data: { password: await hashPassword(process.env[person.passwordEnv]!) },
        });
        passwordUpdates.push(`${p.name} <${p.email}>`);
      }
    }

    // ── Verify nothing was lost ──────────────────────────────────────────────
    const after = {
      users: await prisma.user.count(),
      feedback: await prisma.guestFeedback.count(),
      branches: await prisma.branch.count(),
      documents: await prisma.document.count(),
    };

    console.log(`\n  Applied: ${created} created · ${updated} updated`);
    if (emailUpdates.length) {
      console.log(`  Email changed for ${emailUpdates.length} existing account(s):`);
      for (const n of emailUpdates) console.log(`    - ${n}`);
    }
    if (passwordUpdates.length) {
      console.log(`  Passwords reset for ${passwordUpdates.length} existing account(s):`);
      for (const n of passwordUpdates) console.log(`    - ${n}`);
    } else {
      console.log(
        "  Passwords for existing accounts left unchanged (pass --reset-passwords to apply the supplied ones).",
      );
    }

    console.log(
      `\n  After:  users=${after.users} branches=${after.branches} feedback=${after.feedback} documents=${after.documents}`,
    );

    const problems: string[] = [];
    if (after.feedback !== before.feedback) problems.push(`feedback changed: ${before.feedback} → ${after.feedback}`);
    if (after.branches !== before.branches) problems.push(`branches changed: ${before.branches} → ${after.branches}`);
    if (after.documents !== before.documents) problems.push(`documents changed: ${before.documents} → ${after.documents}`);
    if (after.users !== before.users + created) {
      problems.push(`unexpected user count: expected ${before.users + created}, got ${after.users}`);
    }

    if (problems.length) {
      console.error(`\n  ✖ Data-integrity check FAILED:\n${problems.map((x) => `    - ${x}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  ✓ Data integrity intact (bcrypt cost ${SALT_ROUNDS}, no plaintext stored).`);
  },
);
