import httpStatus from "http-status";
import { NextFunction, Request, Response } from "express";
import { Role } from "../../generated/prisma/enums";
import { jwtHelpers } from "../utils/jwtHelpers";
import { prisma } from "../lib/prisma";
import { appError } from "../utils/appError";
import env from "../config/env";

/**
 * Extracts the Bearer token from either the HttpOnly cookie or the
 * Authorization header ("Bearer <token>").
 */
function extractToken(req: Request): string | null {
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

/**
 * Authentication & authorization guard.
 *
 * Strategy: verify the JWT cryptographically, then perform a minimal DB
 * check (select 6 scalar fields only) to catch deactivated or soft-deleted
 * users whose token has not yet expired. This balances security with
 * performance — the select payload is ~80% smaller than a full row fetch.
 */
export const authGuard = (...requiredRoles: Role[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) {
      throw appError("You are not authorized to access this resource", httpStatus.UNAUTHORIZED);
    }

    let decoded: { id: number; email: string; role: string };
    try {
      decoded = jwtHelpers.verifyToken(token, env.jwt_access_secret) as typeof decoded;
    } catch {
      throw appError("Invalid or expired access token", httpStatus.UNAUTHORIZED);
    }

    // Minimal DB check — only the fields required for session validation.
    const user = await prisma.user.findUnique({
      where: { id: Number(decoded.id), isDeleted: false },
      select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true },
    });

    if (!user) {
      throw appError("User not found or has been deleted", httpStatus.UNAUTHORIZED);
    }
    if (!user.isActive) {
      throw appError("Your account has been suspended", httpStatus.FORBIDDEN);
    }
    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
      throw appError("Forbidden: You do not have permission to perform this action", httpStatus.FORBIDDEN);
    }

    req.user = { id: user.id, email: user.email, name: user.name, role: user.role, branchId: user.branchId };
    next();
  };
};
