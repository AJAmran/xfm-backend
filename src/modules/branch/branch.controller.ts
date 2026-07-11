import { Request, Response } from "express";
import httpStatus from "http-status";
import * as branchService from "./branch.service";
import { successResponse } from "../../utils/apiResponse";
import { BranchQueryInput } from "./branch.validation";

export async function create(req: Request, res: Response) {
  const branch = await branchService.createBranch(req.body);
  successResponse(res, "Branch created successfully", branch, httpStatus.CREATED);
}

export async function getById(req: Request, res: Response) {
  const branch = await branchService.getBranchById(Number(req.params.id));
  successResponse(res, "Branch retrieved successfully", branch);
}

export async function list(req: Request, res: Response) {
  const query = req.query as unknown as BranchQueryInput;
  const result = await branchService.getPaginatedBranches(query);
  successResponse(res, "Branches retrieved successfully", result);
}

export async function listActive(req: Request, res: Response) {
  const branches = await branchService.getAllActiveBranches();
  successResponse(res, "Active branches retrieved successfully", branches);
}

export async function update(req: Request, res: Response) {
  const branch = await branchService.updateBranch(Number(req.params.id), req.body);
  successResponse(res, "Branch updated successfully", branch);
}

export async function remove(req: Request, res: Response) {
  await branchService.deleteBranch(Number(req.params.id));
  successResponse(res, "Branch deleted successfully", {});
}

export async function updateStatus(req: Request, res: Response) {
  const branch = await branchService.setBranchStatus(Number(req.params.id), req.body.isActive);
  successResponse(res, "Branch status updated successfully", branch);
}
