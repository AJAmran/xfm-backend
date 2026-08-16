import NodeCache from "node-cache";
import { Redis } from "ioredis";
import env from "../config/env";
import { logger } from "./logger";

// In-process fallback cache (single instance). All reads/writes go through
// `getOrSet` helper functions below, so switching stores stays transparent.
export const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

// ─── Optional shared store (Redis) ───────────────────────────
// When REDIS_URL is configured we ALSO read/write the same keys in Redis so
// multiple instances (or restarts) share analytics + session data. If Redis
// is unreachable at boot, or drops mid-flight, we degrade to NodeCache — the
// app never depends on Redis being present.
let redis: Redis | null = null;
let redisActive = false;

if (env.redis_url) {
  redis = new Redis(env.redis_url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  redis.on("error", (err) => logger.warn({ err }, "Redis connection error; using in-memory cache"));
  redis
    .connect()
    .then(async () => {
      await redis!.ping();
      redisActive = true;
      logger.info("Redis cache connected");
    })
    .catch((err) => {
      redisActive = false;
      logger.warn({ err }, "Redis unavailable; falling back to in-memory cache");
    });
}

async function storeGet<T>(key: string): Promise<T | undefined> {
  if (redisActive && redis) {
    try {
      const raw = await redis.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      redisActive = false;
      logger.warn({ err }, "Redis read failed; falling back to in-memory cache");
    }
  }
  return cache.get<T>(key);
}

async function storeSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (redisActive && redis) {
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds ?? 300);
      return;
    } catch (err) {
      redisActive = false;
      logger.warn({ err }, "Redis write failed; falling back to in-memory cache");
    }
  }
  if (ttlSeconds !== undefined) cache.set(key, value, ttlSeconds);
  else cache.set(key, value);
}

async function storeDel(...keys: string[]): Promise<void> {
  if (redisActive && redis) {
    try {
      await redis.del(...keys);
      return;
    } catch (err) {
      redisActive = false;
      logger.warn({ err }, "Redis delete failed; falling back to in-memory cache");
    }
  }
  for (const key of keys) cache.del(key);
}

async function storeDelByPrefix(prefix: string): Promise<number> {
  if (redisActive && redis) {
    try {
      let cursor = "0";
      let deleted = 0;
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
        cursor = next;
        if (keys.length) {
          deleted += keys.length;
          await redis.del(...keys);
        }
      } while (cursor !== "0");
      return deleted;
    } catch (err) {
      redisActive = false;
      logger.warn({ err }, "Redis scan/delete failed; falling back to in-memory cache");
    }
  }
  let deleted = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.del(key);
      deleted++;
    }
  }
  return deleted;
}

/**
 * A helper function to fetch from cache, or execute the fetcher function if not found.
 */
export async function withCache<T>(key: string, fetcher: () => Promise<T>, ttlSeconds?: number): Promise<T> {
  const cached = await storeGet<T>(key);
  if (cached !== undefined) {
    return cached;
  }

  const data = await fetcher();
  await storeSet(key, data, ttlSeconds);
  return data;
}

// ─── Session cache (authGuard) ────────────────────────────────
// The per-request user lookup in authGuard is cached for a few seconds so
// high-latency remote DB links don't add a full round-trip to every request.
// Revocation is preserved: tokenVersion bumps (logout/password change) and
// login/refresh all call invalidateUserSession, and deactivation/role changes
// surface within the TTL.

export const SESSION_CACHE_TTL_SECONDS = 10;

export const sessionKey = (userId: number): string => `session_${userId}`;

export async function invalidateUserSession(userId: number): Promise<void> {
  // Drop the authGuard snapshot AND the refresh-token family so revocations
  // (logout, password/role change, reuse detection) apply to both tokens.
  await storeDel(sessionKey(userId), refreshFamilyKey(userId));
}

// ─── Refresh token families (rotation / reuse detection) ─────────
// Each user has a "family" of refresh tokens tracked by their `jti`. On every
// successful refresh the old token moves to `previous` and a fresh one becomes
// `current`. Presenting a token that is no longer `current` means replay — the
// whole session is revoked via tokenVersion. The cache TTL is the refresh
// lifetime (plus a small margin) so families persist as long as tokens do.

export const refreshFamilyKey = (userId: number): string => `refresh_family_${userId}`;

export interface RefreshFamily {
  current?: string;
  previous?: string;
}

export async function getRefreshFamily(userId: number): Promise<RefreshFamily | undefined> {
  return storeGet<RefreshFamily>(refreshFamilyKey(userId));
}

export async function setRefreshFamily(
  userId: number,
  family: RefreshFamily,
  ttlSeconds?: number,
): Promise<void> {
  await storeSet(refreshFamilyKey(userId), family, ttlSeconds);
}

/**
 * Delete every cached entry whose key starts with any of the given prefixes.
 * Used to invalidate derived analytics the moment source data changes
 * (e.g. a new feedback submission) so dashboards stay near-real-time.
 */
export async function invalidateByPrefix(...prefixes: string[]): Promise<number> {
  let deleted = 0;
  for (const prefix of prefixes) {
    deleted += await storeDelByPrefix(prefix);
  }
  return deleted;
}