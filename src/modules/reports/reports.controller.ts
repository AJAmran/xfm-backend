import httpStatus from "http-status";
import { Request, Response } from "express";
import * as reportsService from "./reports.service";
import { successResponse } from "../../utils/apiResponse";

export async function daily(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await reportsService.getDailyReport(branchId);
  successResponse(res, "Daily report retrieved successfully", data);
}

export async function weekly(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await reportsService.getWeeklyReport(branchId);
  successResponse(res, "Weekly report retrieved successfully", data);
}

export async function monthly(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const data = await reportsService.getMonthlyReport(branchId);
  successResponse(res, "Monthly report retrieved successfully", data);
}

export async function branch(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId! : Number(req.query.branchId);
  const data = await reportsService.getBranchReport(branchId);
  successResponse(res, "Branch report retrieved successfully", data);
}

export async function exportExcel(req: Request, res: Response) {
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;

  const workbook = await reportsService.exportExcel(branchId, startDate, endDate);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=feedbacks.xlsx");

  await workbook.xlsx.write(res);
  res.end();
}

export async function exportPdf(_req: Request, res: Response) {
  res.status(httpStatus.NOT_IMPLEMENTED).json({
    success: false,
    message: "PDF export is not yet implemented",
  });
}

function getScopedBranchId(req: Request): number | undefined {
  return req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
}

async function writeWorkbook(res: Response, workbook: Awaited<ReturnType<typeof reportsService.exportExcel>>, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  await workbook.xlsx.write(res);
  res.end();
}

export async function exportManagerReportsExcel(req: Request, res: Response) {
  const branchId = getScopedBranchId(req);
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const workbook = await reportsService.exportManagerReportsExcel(branchId, startDate, endDate);
  await writeWorkbook(res, workbook, "manager-reports.xlsx");
}

export async function exportDiscountLogsExcel(req: Request, res: Response) {
  const branchId = getScopedBranchId(req);
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const workbook = await reportsService.exportDiscountLogsExcel(branchId, startDate, endDate);
  await writeWorkbook(res, workbook, "guest-discount-logs.xlsx");
}

export async function exportEntertainmentLogsExcel(req: Request, res: Response) {
  const branchId = getScopedBranchId(req);
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const workbook = await reportsService.exportEntertainmentLogsExcel(branchId, startDate, endDate);
  await writeWorkbook(res, workbook, "guest-entertainment-logs.xlsx");
}

export async function exportInventoryExcel(req: Request, res: Response) {
  const branchId = getScopedBranchId(req);
  const statementMonth = req.query.statementMonth as string | undefined;
  const workbook = await reportsService.exportInventoryExcel(branchId, statementMonth);
  await writeWorkbook(res, workbook, "inventory-statement.xlsx");
}
