import { Request, Response } from "express";
import * as settingsService from "./settings.service";
import { successResponse } from "../../utils/apiResponse";

export async function get(_req: Request, res: Response) {
  const settings = await settingsService.getSettings();
  successResponse(res, "Settings retrieved successfully", settings);
}

export async function update(req: Request, res: Response) {
  const settings = await settingsService.updateSettings(req.body);
  successResponse(res, "Settings updated successfully", settings);
}
