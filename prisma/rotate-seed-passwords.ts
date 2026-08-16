import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, Role } from "../generated/prisma/client";

// One-off hardening script: rotates the passwords of the accounts that the
// legacy seed created with well-known defaults ("SuperAdmin@123", etc.).
// It does NOT wipe any data. Run: npx tsx prisma/rotate-seed-passwords.ts
//
// Passwords come from env if set, otherwise they are generated and printed.

const dbUrl = new URL(process.env.DATABASE_URL!);
const useSsl =
  process.env.DATABASE_SSL !== undefined
    ? process.env.DATABASE_SSL === "true"
    : dbUrl.searchParams.get("ssl-mode") === "REQUIRED";

const adapter = new PrismaMariaDb({
  host: dbUrl.hostname,
  port: dbUrl.port ? Number(dbUrl.port) : 3306,
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.slice(1),
  connectTimeout: 10_000,
  acquireTimeout: 15_000,
  minimumIdle: 1,
  ...(useSsl
    ? {
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {}),
});
const prisma = new PrismaClient({ adapter });

const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

const SEED_ACCOUNTS: { email: string; role: Role; envKey: string; label: string }[] = [
  { email: "superadmin@x-grouprestaurant.com", role: Role.SUPER_ADMIN, envKey: "SEED_SUPER_ADMIN_PASSWORD", label: "Super Admin" },
  { email: "admin@x-grouprestaurant.com", role: Role.ADMIN, envKey: "SEED_ADMIN_PASSWORD", label: "Admin" },
  ...["xian", "xenial", "xiamen", "golden.chm", "xindian", "xinxian.dhan", "4seasons", "xinxian.mirpur", "chungwah", "xinxian.uttara", "shimanto", "xinxian.mirpur1", "zamzam", "zamzam.mirpur", "4season"].map(
    (local) => ({
      email: `${local}@x-grouprestaurant.com`,
      role: Role.BRANCH_MANAGER,
      envKey: "SEED_MANAGER_PASSWORD",
      label: `Manager (${local})`,
    }),
  ),
];

function generateStrongPassword(length = 24): string {
  return randomBytes(length).toString("base64url");
}

async function main() {
  console.log("🔐 Rotating seed account passwords...\n");

  let rotated = 0;
  for (const account of SEED_ACCOUNTS) {
    const existing = await prisma.user.findFirst({
      where: { email: account.email, isDeleted: false },
      select: { id: true },
    });
    if (!existing) {
      console.log(`  − ${account.email} — account not found, skipped`);
      continue;
    }

    const password = process.env[account.envKey] ?? generateStrongPassword();
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.update({
      where: { id: existing.id },
      data: { password: hashed, tokenVersion: { increment: 1 } },
    });

    console.log(`  ✓ ${account.email} → password: ${password}`);
    rotated += 1;
  }

  console.log(`\n✅ Rotated ${rotated} account(s). Existing sessions have been revoked.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Rotation failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
