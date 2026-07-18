import NodeCache from "node-cache";

// StdTTL in seconds. Default is 5 minutes (300 seconds).
export const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

/**
 * A helper function to fetch from cache, or execute the fetcher function if not found.
 */
export async function withCache<T>(key: string, fetcher: () => Promise<T>, ttlSeconds?: number): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== undefined) {
    return cached;
  }

  const data = await fetcher();
  
  if (ttlSeconds !== undefined) {
    cache.set(key, data, ttlSeconds);
  } else {
    cache.set(key, data);
  }
  
  return data;
}
