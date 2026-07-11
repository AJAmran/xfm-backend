import { Request, Response } from "express";
import httpStatus from "http-status";
import * as feedbackService from "./feedback.service";
import { successResponse } from "../../utils/apiResponse";
import { FeedbackQueryInput } from "./feedback.validation";

export async function submit(req: Request, res: Response) {
  const feedback = await feedbackService.submitFeedback(req.body);
  successResponse(res, "Feedback submitted successfully", feedback, httpStatus.CREATED);
}

export async function getById(req: Request, res: Response) {
  const feedback = await feedbackService.getFeedbackById(Number(req.params.id));
  successResponse(res, "Feedback retrieved successfully", feedback);
}

export async function list(req: Request, res: Response) {
  const query = req.query as unknown as FeedbackQueryInput;
  const branchId = req.user?.role === "BRANCH_MANAGER" ? req.user.branchId ?? undefined : undefined;
  const result = await feedbackService.getPaginatedFeedbacks(query, branchId);
  successResponse(res, "Feedbacks retrieved successfully", result);
}
