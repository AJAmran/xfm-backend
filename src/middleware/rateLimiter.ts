import rateLimit from "express-rate-limit";
import env from "../config/env";

/**
 * Global rate limiter — applied to all routes as a baseline.
 *
 * Sized for an authenticated dashboard behind shared office NAT IPs:
 * one tab fires ~8-12 API calls per page load, and a whole office can
 * share a single egress IP. 2000 req / 15 min ≈ 2.2 req/s sustained —
 * generous for humans, still a hard ceiling for abusive clients.
 * Override with RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS.
 *
 * The realtime SSE stream is skipped: it holds ONE long-lived,
 * authenticated connection per tab, and counting (re)connects against
 * the budget causes retry storms exactly when the budget is exhausted.
 */
export const globalLimiter = rateLimit({
  windowMs: env.rate_limit_window_ms,
  max: env.rate_limit_max,
  standardHeaders: "draft-8", // RFC-compliant RateLimit header (express-rate-limit v7+)
  legacyHeaders: false,
  skip: (req) => req.originalUrl.startsWith("/api/v1/realtime/"),
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
    errors: [],
  },
});

/**
 * Strict limiter for authentication endpoints to prevent brute-force attacks.
 * Kept tight on purpose — login pages must not become password oracles.
 * Override with AUTH_RATE_LIMIT_MAX.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.auth_rate_limit_max,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in 15 minutes.",
    errors: [],
  },
});
