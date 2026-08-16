import jwt, { Secret, SignOptions } from "jsonwebtoken";

/**
 * Convert a JWT expiresIn value into milliseconds. Supports jsonwebtoken's
 * shorthand units ("30s", "15m", "2h", "7d") and raw seconds.
 */
const parseExpiryToMs = (expiresIn: string): number => {
  const trimmed = expiresIn.trim();
  const match = /^(\d+)\s*([smhd])?$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid JWT expiry value: "${expiresIn}". Expected e.g. "15m", "2h", "7d" or raw seconds.`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const multiplier = multipliers[unit];
  if (!multiplier) {
    throw new Error(`Unsupported JWT expiry unit: "${unit}". Expected s, m, h or d.`);
  }
  return amount * multiplier;
};

/** Create a signed JWT with the given payload, expiry duration and optional claims (e.g. jwtid). */
const generateToken = (
  payload: Record<string, string>,
  secret: Secret,
  expiresIn: string,
  options: SignOptions = {},
): string => {
  return jwt.sign(payload, secret, {
    expiresIn,
    ...options,
  } as SignOptions);
};

/** Verify and decode a JWT, throwing on invalid/expired tokens */
const verifyToken = (token: string, secret: Secret): jwt.JwtPayload => {
  return jwt.verify(token, secret) as jwt.JwtPayload;
};

export const jwtHelpers = {
  generateToken,
  verifyToken,
  parseExpiryToMs,
};
