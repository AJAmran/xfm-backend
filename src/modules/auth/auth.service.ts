import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { jwtHelpers } from "../../utils/jwtHelpers";
import { appError } from "../../utils/appError";
import {
  invalidateUserSession,
  getRefreshFamily,
  setRefreshFamily,
} from "../../lib/cache";
import env from "../../config/env";

/** How long a refresh-token family is tracked in cache (lifetime + margin). */
const REFRESH_FAMILY_TTL_SECONDS =
  Math.floor(jwtHelpers.parseExpiryToMs(env.jwt_refresh_expires_in) / 1000) + 300;

async function revokeSession(userId: number) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  await invalidateUserSession(userId);
}

export async function loginUser(payload: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { email: payload.email, isDeleted: false },
    select: {
      id: true, name: true, email: true, role: true,
      branchId: true, isActive: true, createdAt: true, password: true, tokenVersion: true,
    },
  });

  if (!user) throw appError("No account found matching that email address", httpStatus.NOT_FOUND);
  if (!user.isActive) throw appError("Your account has been suspended", httpStatus.FORBIDDEN);

  const valid = await bcrypt.compare(payload.password, user.password);
  if (!valid) throw appError("Incorrect password", httpStatus.UNAUTHORIZED);

  // Clear any stale session snapshot / refresh family from a previous login,
  // then seed a fresh refresh family so rotation & reuse detection work.
  await invalidateUserSession(user.id);

  const tokenPayload = {
    id: String(user.id),
    email: user.email,
    role: user.role,
    tokenVersion: String(user.tokenVersion),
  };
  const accessToken = jwtHelpers.generateToken(tokenPayload, env.jwt_access_secret, env.jwt_access_expires_in);
  const refreshJti = randomUUID();
  const refreshToken = jwtHelpers.generateToken(
    tokenPayload,
    env.jwt_refresh_secret,
    env.jwt_refresh_expires_in,
    { jwtid: refreshJti },
  );
  await setRefreshFamily(user.id, { current: refreshJti }, REFRESH_FAMILY_TTL_SECONDS);

  const { password: _, ...userWithoutPassword } = user;

  return { accessToken, refreshToken, user: userWithoutPassword };
}

export async function refreshAccessToken(token: string) {
  let decoded: { id: number; email: string; role: string; tokenVersion?: number; jti?: string };
  try {
    const raw = jwtHelpers.verifyToken(token, env.jwt_refresh_secret) as {
      id: string;
      email: string;
      role: string;
      tokenVersion?: string;
      jti?: string;
    };
    decoded = {
      id: Number(raw.id),
      email: raw.email,
      role: raw.role,
      tokenVersion: raw.tokenVersion !== undefined ? Number(raw.tokenVersion) : undefined,
      jti: raw.jti,
    };
  } catch {
    throw appError("Session expired: Refresh token validation failure", httpStatus.UNAUTHORIZED);
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id, isDeleted: false },
    select: { id: true, email: true, role: true, isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive) throw appError("Invalid security context for session rotation", httpStatus.FORBIDDEN);
  if (user.tokenVersion !== (decoded.tokenVersion ?? 0)) {
    throw appError("Session revoked. Please log in again", httpStatus.UNAUTHORIZED);
  }

  // Refresh-token rotation with reuse detection.
  const presentedJti = decoded.jti;
  if (!presentedJti) {
    // Tokens issued before this feature have no jti — refuse and force re-login.
    await revokeSession(user.id);
    throw appError("Session must be re-established. Please log in again", httpStatus.UNAUTHORIZED);
  }

  const family = await getRefreshFamily(user.id);
  if (family) {
    const isCurrent = presentedJti === family.current;
    const isPrevious = presentedJti === family.previous;
    if (!isCurrent && (isPrevious || family.current !== undefined)) {
      // A rotated-out token was replayed — revoke the entire session family.
      await revokeSession(user.id);
      throw appError("Session token reuse detected. Please log in again", httpStatus.UNAUTHORIZED);
    }
  }

  // Issue fresh token pair. The new refresh token becomes `current` and the
  // presented one moves to `previous`, so a later replay is detected.
  const newRefreshJti = randomUUID();
  const newRefreshToken = jwtHelpers.generateToken(
    { id: String(user.id), email: user.email, role: user.role, tokenVersion: String(user.tokenVersion) },
    env.jwt_refresh_secret,
    env.jwt_refresh_expires_in,
    { jwtid: newRefreshJti },
  );
  await setRefreshFamily(
    user.id,
    { current: newRefreshJti, previous: presentedJti },
    REFRESH_FAMILY_TTL_SECONDS,
  );

  const newAccessToken = jwtHelpers.generateToken(
    { id: String(user.id), email: user.email, role: user.role, tokenVersion: String(user.tokenVersion) },
    env.jwt_access_secret,
    env.jwt_access_expires_in,
  );

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

export async function logoutUser(token: string) {
  try {
    const decoded = jwtHelpers.verifyToken(token, env.jwt_access_secret) as { id?: string };
    if (!decoded?.id) return;
    await revokeSession(Number(decoded.id));
  } catch {
    // Invalid/expired token — nothing to revoke server-side.
  }
}

export async function getCurrentUser(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId, isDeleted: false },
    select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true, createdAt: true },
  });
  if (!user) throw appError("User not found", httpStatus.NOT_FOUND);
  return user;
}
