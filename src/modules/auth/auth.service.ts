import bcrypt from "bcrypt";
import httpStatus from "http-status";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { jwtHelpers } from "../../utils/jwtHelpers";
import { appError } from "../../utils/appError";
import env from "../../config/env";

/**
 * Converts a JWT expiry string like "7d", "15m", "1h" to milliseconds.
 * Used to keep the DB refresh token TTL in sync with the JWT expiry config.
 */
function parseExpiryToMs(expiry: string): number {
  const unit = expiry.slice(-1);
  const value = parseInt(expiry.slice(0, -1), 10);
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default:  return 7 * 24 * 60 * 60 * 1000; // fallback: 7 days
  }
}

export async function loginUser(payload: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { email: payload.email, isDeleted: false },
    select: {
      id: true, name: true, email: true, role: true,
      branchId: true, isActive: true, createdAt: true, password: true,
    },
  });

  if (!user) throw appError("No account found matching that email address", httpStatus.NOT_FOUND);
  if (!user.isActive) throw appError("Your account has been suspended", httpStatus.FORBIDDEN);

  const valid = await bcrypt.compare(payload.password, user.password);
  if (!valid) throw appError("Incorrect password", httpStatus.UNAUTHORIZED);

  const tokenPayload = { id: String(user.id), email: user.email, role: user.role };
  const accessToken = jwtHelpers.generateToken(tokenPayload, env.jwt_access_secret, env.jwt_access_expires_in);
  const refreshToken = jwtHelpers.generateToken(tokenPayload, env.jwt_refresh_secret, env.jwt_refresh_expires_in);

  const hashedRefreshToken = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const expiresAt = new Date(Date.now() + parseExpiryToMs(env.jwt_refresh_expires_in));

  // Atomic: store the new refresh token AND clean up expired tokens in one transaction.
  await prisma.$transaction([
    prisma.refreshToken.create({
      data: { userId: user.id, token: hashedRefreshToken, expiresAt },
    }),
    // Remove expired tokens for this user to keep the table clean.
    prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    }),
  ]);

  const { password: _, ...userWithoutPassword } = user;
  return { accessToken, refreshToken, user: userWithoutPassword };
}

export async function refreshAccessToken(token: string) {
  let decoded: { id: number; email: string; role: string };
  try {
    decoded = jwtHelpers.verifyToken(token, env.jwt_refresh_secret) as unknown as typeof decoded;
  } catch {
    throw appError("Session expired: Refresh token validation failure", httpStatus.UNAUTHORIZED);
  }

  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  const stored = await prisma.refreshToken.findUnique({ where: { token: hashed } });
  if (!stored || stored.expiresAt < new Date()) {
    throw appError("Refresh token expired or revoked", httpStatus.UNAUTHORIZED);
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id, isDeleted: false },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw appError("Invalid security context for session rotation", httpStatus.FORBIDDEN);

  const newAccessToken = jwtHelpers.generateToken(
    { id: String(user.id), email: user.email, role: user.role },
    env.jwt_access_secret,
    env.jwt_access_expires_in,
  );

  return { accessToken: newAccessToken };
}

export async function logoutUser(token: string) {
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.refreshToken.deleteMany({ where: { token: hashed } });
}

export async function getCurrentUser(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId, isDeleted: false },
    select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true, createdAt: true },
  });
  if (!user) throw appError("User not found", httpStatus.NOT_FOUND);
  return user;
}
