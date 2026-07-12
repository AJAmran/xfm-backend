import rateLimit from "express-rate-limit";

/**
 * Global rate limiter — applied to all routes as a baseline.
 * Tuned for an authenticated dashboard app with frequent polling.
 * https://express-rate-limit.mintlify.app/reference/configuration
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,                  // generous limit for dashboard users
  standardHeaders: "draft-8", // RFC-compliant RateLimit header (express-rate-limit v7+)
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
    errors: [],
  },
});

/**
 * Strict limiter for authentication endpoints to prevent brute-force attacks.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                   // 10 attempts per window per IP
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in 15 minutes.",
    errors: [],
  },
});
