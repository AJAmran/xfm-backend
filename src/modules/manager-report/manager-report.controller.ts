import { Request, Response } from "express";
import httpStatus from "http-status";
import * as managerReportService from "./manager-report.service";
import { successResponse } from "../../utils/apiResponse";
import { parsedQuery } from "../../middleware/validation";
import { ManagerReportQueryInput } from "./manager-report.validation";

export async function create(req: Request, res: Response) {
  const report = await managerReportService.createReport(req.body, req.user!);
  successResponse(res, "Manager report created successfully", report, httpStatus.CREATED);
}

export async function list(req: Request, res: Response) {
  const query = parsedQuery<ManagerReportQueryInput>(res);
  const result = await managerReportService.getPaginatedReports(query, req.user!);
  successResponse(res, "Manager reports retrieved successfully", result);
}

export async function summary(req: Request, res: Response) {
  const result = await managerReportService.getReportSummary(req.user!);
  successResponse(res, "Manager report summary retrieved successfully", result);
}

export async function getById(req: Request, res: Response) {
  const report = await managerReportService.getReportById(Number(req.params.id), req.user!);
  successResponse(res, "Manager report retrieved successfully", report);
}

export async function update(req: Request, res: Response) {
  const report = await managerReportService.updateReport(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Manager report updated successfully", report);
}

export async function remove(req: Request, res: Response) {
  await managerReportService.deleteReport(Number(req.params.id), req.user!);
  successResponse(res, "Manager report deleted successfully", {});
}

export async function setApproval(req: Request, res: Response) {
  const report = await managerReportService.setReportApproval(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Manager report approval updated successfully", report);
}

export async function getComments(req: Request, res: Response) {
  const comments = await managerReportService.getReportComments(Number(req.params.id), req.user!);
  successResponse(res, "Manager report comments retrieved successfully", comments);
}

export async function addComment(req: Request, res: Response) {
  const comment = await managerReportService.addReportComment(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Manager report comment added successfully", comment, httpStatus.CREATED);
}
