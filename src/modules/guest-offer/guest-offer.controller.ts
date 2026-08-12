import { Request, Response } from "express";
import httpStatus from "http-status";
import * as guestOfferService from "./guest-offer.service";
import { successResponse } from "../../utils/apiResponse";
import { parsedQuery } from "../../middleware/validation";
import { GuestOfferQueryInput } from "./guest-offer.validation";

// ─── Discount logs ────────────────────────────────────────────────────────────

export async function createDiscount(req: Request, res: Response) {
  const log = await guestOfferService.createDiscountLog(req.body, req.user!);
  successResponse(res, "Guest discount log created successfully", log, httpStatus.CREATED);
}

export async function listDiscounts(req: Request, res: Response) {
  const query = parsedQuery<GuestOfferQueryInput>(res);
  const result = await guestOfferService.getPaginatedDiscountLogs(query, req.user!);
  successResponse(res, "Guest discount logs retrieved successfully", result);
}

export async function getDiscountById(req: Request, res: Response) {
  const log = await guestOfferService.getDiscountLogById(Number(req.params.id), req.user!);
  successResponse(res, "Guest discount log retrieved successfully", log);
}

export async function updateDiscount(req: Request, res: Response) {
  const log = await guestOfferService.updateDiscountLog(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Guest discount log updated successfully", log);
}

export async function setDiscountApproval(req: Request, res: Response) {
  const log = await guestOfferService.setDiscountLogApproval(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Guest discount log approval updated successfully", log);
}

export async function removeDiscount(req: Request, res: Response) {
  await guestOfferService.deleteDiscountLog(Number(req.params.id), req.user!);
  successResponse(res, "Guest discount log deleted successfully", {});
}

// ─── Entertainment logs ───────────────────────────────────────────────────────

export async function createEntertainment(req: Request, res: Response) {
  const log = await guestOfferService.createEntertainmentLog(req.body, req.user!);
  successResponse(res, "Guest entertainment log created successfully", log, httpStatus.CREATED);
}

export async function listEntertainments(req: Request, res: Response) {
  const query = parsedQuery<GuestOfferQueryInput>(res);
  const result = await guestOfferService.getPaginatedEntertainmentLogs(query, req.user!);
  successResponse(res, "Guest entertainment logs retrieved successfully", result);
}

export async function getEntertainmentById(req: Request, res: Response) {
  const log = await guestOfferService.getEntertainmentLogById(Number(req.params.id), req.user!);
  successResponse(res, "Guest entertainment log retrieved successfully", log);
}

export async function updateEntertainment(req: Request, res: Response) {
  const log = await guestOfferService.updateEntertainmentLog(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Guest entertainment log updated successfully", log);
}

export async function setEntertainmentApproval(req: Request, res: Response) {
  const log = await guestOfferService.setEntertainmentLogApproval(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Guest entertainment log approval updated successfully", log);
}

export async function removeEntertainment(req: Request, res: Response) {
  await guestOfferService.deleteEntertainmentLog(Number(req.params.id), req.user!);
  successResponse(res, "Guest entertainment log deleted successfully", {});
}

// ─── Daily summary ────────────────────────────────────────────────────────────

export async function summary(req: Request, res: Response) {
  const query = parsedQuery<GuestOfferQueryInput>(res);
  const result = await guestOfferService.getDailySummary(query, req.user!);
  successResponse(res, "Daily guest offer summary retrieved successfully", result);
}
