import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { jwtHelpers } from "../../utils/jwtHelpers";
import { appError } from "../../utils/appError";
import env from "../../config/env";

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

  const { password: _, ...userWithoutPassword } = user;
  return { accessToken, refreshToken, user: userWithoutPassword };
}

export async function refreshAccessToken(token: string) {
  let decoded: { id: number; email: string; role: string };
  try {
    const raw = jwtHelpers.verifyToken(token, env.jwt_refresh_secret) as { id: string; email: string; role: string };
    decoded = { id: Number(raw.id), email: raw.email, role: raw.role };
  } catch {
    throw appError("Session expired: Refresh token validation failure", httpStatus.UNAUTHORIZED);
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

export async function logoutUser(_token: string) {
  // Stateless — frontend discards the token
}

export async function getCurrentUser(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId, isDeleted: false },
    select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true, createdAt: true },
  });
  if (!user) throw appError("User not found", httpStatus.NOT_FOUND);
  return user;
}
