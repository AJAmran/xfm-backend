import { Request, Response } from "express";
import httpStatus from "http-status";
import { appError } from "../../utils/appError";
import { successResponse } from "../../utils/apiResponse";
import * as authService from "./auth.service";
import env from "../../config/env";

const isProduction = env.node_env === "production";

function setCookie(res: Response, name: string, value: string, maxAge: number) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge,
  });
}

export async function login(req: Request, res: Response) {
  const result = await authService.loginUser(req.body);
  setCookie(res, "accessToken", result.accessToken, 1000 * 60 * 60 * 24);
  setCookie(res, "refreshToken", result.refreshToken, 1000 * 60 * 60 * 24 * 7);

  successResponse(res, "User logged in successfully", {
    accessToken: result.accessToken,
    user: result.user,
  }, httpStatus.OK);
}

export async function refreshToken(req: Request, res: Response) {
  const token = req.cookies?.refreshToken;
  if (!token) throw appError("Refresh token not found", httpStatus.UNAUTHORIZED);

  const result = await authService.refreshAccessToken(token);
  setCookie(res, "accessToken", result.accessToken, 1000 * 60 * 60 * 24);

  successResponse(res, "Access token renewed successfully", result, httpStatus.OK);
}

export async function logout(req: Request, res: Response) {
  if (req.cookies?.accessToken) {
    res.clearCookie("accessToken", { httpOnly: true, secure: isProduction, sameSite: isProduction ? "none" : "lax" });
    res.clearCookie("refreshToken", { httpOnly: true, secure: isProduction, sameSite: isProduction ? "none" : "lax" });
  }
  successResponse(res, "User logged out successfully", {});
}

export async function me(req: Request, res: Response) {
  const user = await authService.getCurrentUser(req.user!.id);
  successResponse(res, "Current user retrieved successfully", user);
}
