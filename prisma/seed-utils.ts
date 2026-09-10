import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { Role } from "../generated/prisma/enums";

export const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

/** Env keys for account passwords (single source of truth). */
export const SEED_MANAGER_ENV_KEY = "SEED_MANAGER_PASSWORD";

/** Build an isolated Prisma client for standalone scripts (mirrors src/lib/prisma). */
export function createSeedClient(): PrismaClient {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL is missing. Copy .env.example to .env and set DATABASE_URL before running seed scripts.",
    );
  }
  const dbUrl = new URL(rawUrl);
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
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  return new PrismaClient({ adapter });
}

function generateStrongPassword(length = 24): string {
  return randomBytes(length).toString("base64url");
}

export function resolveSeedPassword(envKey: string, label: string, fallback?: string): string {
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  if (fallback) return fallback;
  const generated = generateStrongPassword();
  console.warn(`  ⚠ ${envKey} not set — using a generated password for ${label}. Set ${envKey} to pin it.`);
  console.log(`    ${label} login → password: ${generated}`);
  return generated;
}

export interface SeedAccount {
  name: string;
  email: string;
  role: Role;
  envKey: string;
  label: string;
  /** Pinned fallback when the env var is unset (provisioned credentials). */
  fallbackPassword?: string;
  /** Approval signature image stamped on records this user approves. */
  signatureUrl?: string;
  branchId?: number | null;
}

/** Single source of truth for well-known accounts across seed/rotate/ensure scripts. */
export const KNOWN_ACCOUNTS: Omit<SeedAccount, "branchId">[] = [
  { name: "Super Administrator", email: "superadmin@x-grouprestaurant.com", role: Role.SUPER_ADMIN, envKey: "SEED_SUPER_ADMIN_PASSWORD", label: "Super Admin" },
  { name: "System Administrator", email: "admin@x-grouprestaurant.com", role: Role.ADMIN, envKey: "SEED_ADMIN_PASSWORD", label: "Admin" },
  { name: "Chief Operating Officer", email: "coo@x-grouprestaurant.com", role: Role.COO, envKey: "SEED_CEO_PASSWORD", label: "COO", fallbackPassword: "Coo@2026", signatureUrl: process.env.SEED_COO_SIGNATURE ?? process.env.SEED_CEO_SIGNATURE ?? "https://res.cloudinary.com/dhukcjdmi/image/upload/v1788755595/coo_cbik4c.png" },
  { name: "Managing Director", email: "md@x-grouprestaurant.com", role: Role.MD, envKey: "SEED_MD_PASSWORD", label: "MD", fallbackPassword: "Managingderector@2026" },
];

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Standard runner: banner, error handling with exit codes, guaranteed
 * disconnect. Every script's main() should run through this.
 */
export async function runScript(title: string, fn: (prisma: PrismaClient) => Promise<void>): Promise<void> {
  console.log(`\n${title}\n`);
  const prisma = createSeedClient();
  try {
    await fn(prisma);
    console.log("\n✅ Done.");
  } catch (e) {
    console.error("\n❌ FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
