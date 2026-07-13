import { Request, Response } from "express";
import * as dashboardService from "./dashboard.service";
import { successResponse } from "../../utils/apiResponse";
import { DashboardQueryInput } from "./dashboard.validation";
import { parsedQuery } from "../../middleware/validation";

export async function summary(req: Request, res: Response) {
  const query = parsedQuery<DashboardQueryInput>(res);
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await dashboardService.getSummary(branchId, query.startDate, query.endDate);
  successResponse(res, "Dashboard summary retrieved successfully", data);
}

export async function recentFeedback(req: Request, res: Response) {
  const query = parsedQuery<DashboardQueryInput>(res);
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await dashboardService.getRecentFeedback(branchId, query.startDate, query.endDate);
  successResponse(res, "Recent feedback retrieved successfully", data);
}

export async function branchRanking(req: Request, res: Response) {
  const query = parsedQuery<DashboardQueryInput>(res);
  const data = await dashboardService.getBranchRanking(query.startDate, query.endDate);
  successResponse(res, "Branch ranking retrieved successfully", data);
}

export async function negativeFeedback(req: Request, res: Response) {
  const query = parsedQuery<DashboardQueryInput>(res);
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await dashboardService.getNegativeFeedback(branchId, query.startDate, query.endDate);
  successResponse(res, "Negative feedback retrieved successfully", data);
}
