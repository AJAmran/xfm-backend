import { Request, Response } from "express";
import httpStatus from "http-status";
import { appError } from "../../utils/appError";
import { successResponse } from "../../utils/apiResponse";
import * as authService from "./auth.service";
import { extractToken } from "../../middleware/auth";
import env from "../../config/env";
import { jwtHelpers } from "../../utils/jwtHelpers";

const isProduction = env.node_env === "production";

// Cookie lifetimes mirror the JWT expiry values from env exactly.
const ACCESS_COOKIE_MAX_AGE_MS = jwtHelpers.parseExpiryToMs(env.jwt_access_expires_in);
const REFRESH_COOKIE_MAX_AGE_MS = jwtHelpers.parseExpiryToMs(env.jwt_refresh_expires_in);

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
} as const;

function setCookie(res: Response, name: string, value: string, maxAge: number) {
  res.cookie(name, value, { ...COOKIE_OPTIONS, maxAge });
}

function clearCookie(res: Response, name: string) {
  res.clearCookie(name, COOKIE_OPTIONS);
}

export async function login(req: Request, res: Response) {
  const result = await authService.loginUser(req.body);
  setCookie(res, "accessToken", result.accessToken, ACCESS_COOKIE_MAX_AGE_MS);
  setCookie(res, "refreshToken", result.refreshToken, REFRESH_COOKIE_MAX_AGE_MS);

  successResponse(res, "User logged in successfully", {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
  }, httpStatus.OK);
}

export async function refreshToken(req: Request, res: Response) {
  const token = req.cookies?.refreshToken;
  if (!token) throw appError("Refresh token not found", httpStatus.UNAUTHORIZED);

  const result = await authService.refreshAccessToken(token);
  setCookie(res, "accessToken", result.accessToken, ACCESS_COOKIE_MAX_AGE_MS);
  setCookie(res, "refreshToken", result.refreshToken, REFRESH_COOKIE_MAX_AGE_MS);

  successResponse(res, "Access token renewed successfully", result, httpStatus.OK);
}

export async function logout(req: Request, res: Response) {
  // Support both cookie and Bearer-header authentication (same as authGuard).
  const accessToken = extractToken(req);
  if (accessToken) {
    await authService.logoutUser(accessToken);
    clearCookie(res, "accessToken");
    clearCookie(res, "refreshToken");
  }
  successResponse(res, "User logged out successfully", {});
}

export async function me(req: Request, res: Response) {
  const user = await authService.getCurrentUser(req.user!.id);
  successResponse(res, "Current user retrieved successfully", user);
}
