import { Request, Response } from "express";
import * as dashboardService from "./dashboard.service";
import { successResponse } from "../../utils/apiResponse";

export async function summary(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await dashboardService.getSummary(branchId);
  successResponse(res, "Dashboard summary retrieved successfully", data);
}

export async function recentFeedback(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await dashboardService.getRecentFeedback(branchId);
  successResponse(res, "Recent feedback retrieved successfully", data);
}

export async function branchRanking(_req: Request, res: Response) {
  const data = await dashboardService.getBranchRanking();
  successResponse(res, "Branch ranking retrieved successfully", data);
}

export async function negativeFeedback(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await dashboardService.getNegativeFeedback(branchId);
  successResponse(res, "Negative feedback retrieved successfully", data);
}
