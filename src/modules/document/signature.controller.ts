import { Request, Response } from "express";
import httpStatus from "http-status";
import * as signatureService from "./signature.service";
import { successResponse } from "../../utils/apiResponse";
import { appError } from "../../utils/appError";
import { ALLOWED_SIGNATURE_MIME_TYPES } from "./document.validation";

/**
 * Self-service signature endpoints.
 *
 * There is deliberately no `/users/:id/signature` route: a user may only ever
 * manage their own signature, and the id always comes from the session.
 */

function requestContext(req: Request) {
  return (req.ip ?? req.socket.remoteAddress ?? null)?.toString().slice(0, 191) ?? null;
}

export async function get(req: Request, res: Response) {
  successResponse(res, "Signature retrieved successfully", await signatureService.getOwnSignature(req.user!.id));
}

export async function replace(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    throw appError("Select a signature image to upload", httpStatus.BAD_REQUEST, [
      { field: "signature", message: "A signature image is required" },
    ]);
  }
  if (!(ALLOWED_SIGNATURE_MIME_TYPES as readonly string[]).includes(file.mimetype.toLowerCase())) {
    throw appError("A signature must be a PNG, JPEG or WebP image", httpStatus.UNSUPPORTED_MEDIA_TYPE);
  }

  const result = await signatureService.replaceOwnSignature(req.user!.id, file);
  await signatureService.auditSignatureChange(req.user!.id, "SIGNATURE_UPDATED", requestContext(req));

  successResponse(res, "Signature saved successfully", result, httpStatus.CREATED);
}

export async function clear(req: Request, res: Response) {
  const result = await signatureService.clearOwnSignature(req.user!.id);
  await signatureService.auditSignatureChange(req.user!.id, "SIGNATURE_REMOVED", requestContext(req));

  successResponse(res, "Signature removed successfully", result);
}