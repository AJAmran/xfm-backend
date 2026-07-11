import { Request, Response } from "express";
import * as analyticsService from "./analytics.service";
import { successResponse } from "../../utils/apiResponse";

export async function ratings(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await analyticsService.getRatingAnalytics(branchId);
  successResponse(res, "Rating analytics retrieved successfully", data);
}

export async function branches(_req: Request, res: Response) {
  const data = await analyticsService.getBranchPerformance();
  successResponse(res, "Branch performance retrieved successfully", data);
}

export async function monthly(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await analyticsService.getMonthlyTrends(branchId);
  successResponse(res, "Monthly trends retrieved successfully", data);
}

export async function satisfaction(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await analyticsService.getCustomerSatisfaction(branchId);
  successResponse(res, "Customer satisfaction retrieved successfully", data);
}
