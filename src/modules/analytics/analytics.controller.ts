import { Request, Response } from "express";
import * as analyticsService from "./analytics.service";
import { successResponse } from "../../utils/apiResponse";
import { AnalyticsQueryInput } from "./analytics.validation";
import { parsedQuery } from "../../middleware/validation";

export async function ratings(req: Request, res: Response) {
  const query = parsedQuery<AnalyticsQueryInput>(res);
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await analyticsService.getRatingAnalytics(branchId, query.startDate, query.endDate);
  successResponse(res, "Rating analytics retrieved successfully", data);
}

export async function branches(req: Request, res: Response) {
  const query = parsedQuery<AnalyticsQueryInput>(res);
  const data = await analyticsService.getBranchPerformance(query.startDate, query.endDate);
  successResponse(res, "Branch performance retrieved successfully", data);
}

export async function monthly(req: Request, res: Response) {
  const query = parsedQuery<AnalyticsQueryInput>(res);
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await analyticsService.getMonthlyTrends(branchId, query.startDate, query.endDate);
  successResponse(res, "Monthly trends retrieved successfully", data);
}

export async function satisfaction(req: Request, res: Response) {
  const query = parsedQuery<AnalyticsQueryInput>(res);
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await analyticsService.getCustomerSatisfaction(branchId, query.startDate, query.endDate);
  successResponse(res, "Customer satisfaction retrieved successfully", data);
}

export async function dashboardSummary(req: Request, res: Response) {
  const query = parsedQuery<AnalyticsQueryInput>(res);
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await analyticsService.getDashboardSummary(branchId, query.startDate, query.endDate);
  successResponse(res, "Dashboard summary retrieved successfully", data);
}
