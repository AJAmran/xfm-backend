import { prisma } from "./prisma";
import { withCache, invalidateByPrefix } from "./cache";
import { logger } from "./logger";
import { ROLE_PERMISSIONS, roleKeys, type PermissionKey } from "./permission-catalog";

/**
 * Effective role permissions, served from a JSON config row.
 *
 * Storage is a single `system_settings` row (`key = "role_permissions"`,
 * value = `{ "<ROLE>": ["resource.action", …] }`). When the row is absent the
 * catalog defaults in `permission-catalog.ts` apply; when present, a role's
 * entry in the row REPLACES its catalog entry wholesale (the admin matrix
 * always writes complete per-role arrays, so partial merges can never leave a
 * stale key behind).
 *
 * Server pressure is deliberately ~zero: the row is fetched through the
 * shared 60s cache (`cache.ts`, same as the document policy), so a permission
 * check is an in-memory map read — no extra DB round-trip beyond the user
 * lookup `authGuard` already performs. The admin save path calls
 * `reloadRolePermissions()`, so a change is effective on the very next
 * request (no forced logout, no TTL wait).
 *
 * Unknown roles — and malformed rows — fail closed to an empty set.
 */

export const ROLE_PERMISSIONS_SETTINGS_KEY = "role_permissions";

const ROLE_PERMISSIONS_CACHE_KEY = "rolePermissions.v1.";
const ROLE_PERMISSIONS_TTL_SECONDS = 60;

// Every key the guard layer understands. Both the row sanitizer and the
// effective-set builder filter through it (fail-closed for unknown keys).
const KNOWN_KEYS = new Set<string>(Object.values(ROLE_PERMISSIONS).flat());

export type RolePermissionOverrides = Record<string, string[]>;

function sanitizeOverrides(value: unknown): RolePermissionOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: RolePermissionOverrides = {};
  for (const [role, keys] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(keys)) continue;
    out[role] = keys.filter(
      (key): key is string => typeof key === "string" && KNOWN_KEYS.has(key),
    );
  }
  return out;
}

async function loadRolePermissionOverrides(): Promise<RolePermissionOverrides> {
  const row = await prisma.systemSetting.findUnique({ where: { key: ROLE_PERMISSIONS_SETTINGS_KEY } });
  if (!row?.value) return {};
  try {
    return sanitizeOverrides(JSON.parse(row.value));
  } catch (error) {
    logger.warn({ err: error }, "role_permissions setting is not valid JSON; falling back to catalog");
    return {};
  }
}

export async function getRolePermissionOverrides(): Promise<RolePermissionOverrides> {
  return withCache(ROLE_PERMISSIONS_CACHE_KEY, loadRolePermissionOverrides, ROLE_PERMISSIONS_TTL_SECONDS);
}

/** Drop the cached config row so the next check re-reads it. Call after any admin save. */
export async function reloadRolePermissions(): Promise<void> {
  await invalidateByPrefix(ROLE_PERMISSIONS_CACHE_KEY);
}

/** Effective permission keys for a role string. Never throws. */
export async function permissionsForRole(role: string): Promise<PermissionKey[]> {
  const overrides = await getRolePermissionOverrides();
  // Only catalog keys are admitted here too: a hand-edited row can never
  // invent a permission the guard layer does not understand (fail-closed).
  const keys: string[] = overrides[role] ?? roleKeys(role);
  return keys.filter((key): key is PermissionKey => KNOWN_KEYS.has(key));
}

/** Single-key check used by the Phase 2 route guard (and admin subset checks in Phase 3). */
export async function roleCan(role: string | undefined, key: PermissionKey): Promise<boolean> {
  if (!role) return false;
  return (await permissionsForRole(role)).includes(key);
}
