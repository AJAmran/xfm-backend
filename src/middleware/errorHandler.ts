import { Request, Response, NextFunction } from "express";
import { Prisma } from "../../generated/prisma/client";
import { errorResponse } from "../utils/apiResponse";
import { logger } from "../lib/logger";
import env from "../config/env";

/**
 * Global error handler — maps known error types to appropriate HTTP responses.
 *
 * Priority:
 *   1. AppError (our custom operational errors with statusCode)
 *   2. Prisma known request errors (P2002, P2025, etc.)
 *   3. Zod validation errors (handled upstream by validateSchema middleware)
 *   4. Unexpected errors → 500
 *
 * Reference: https://www.prisma.io/docs/orm/reference/error-reference
 */
export const globalErrorHandler = (
  err: Error & { statusCode?: number; errors?: { field: string; message: string }[] },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // 1. Operational errors thrown by appError() / validationError()
  if (err.statusCode) {
    errorResponse(res, err.message, err.errors ?? [], err.statusCode);
    return;
  }

  // 2. Prisma known request errors (database constraint / not-found errors)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": {
        // Unique constraint violation — extract the field name from meta
        const target = (err.meta?.target as string[] | undefined)?.join(", ") ?? "field";
        errorResponse(res, `A record with this ${target} already exists.`, [], 409);
        return;
      }
      case "P2025":
        // Record not found (e.g. update/delete on non-existent row)
        errorResponse(res, "The requested record was not found.", [], 404);
        return;
      case "P2003":
        // Foreign key constraint failure
        errorResponse(res, "Operation failed: a related record does not exist.", [], 400);
        return;
      default:
        logger.error({ prismaCode: err.code, message: err.message }, "prisma error");
        errorResponse(res, "A database error occurred.", [], 500);
        return;
    }
  }

  // 3. Prisma validation errors (bad query shape — should not reach prod)
  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error({ message: err.message }, "prisma validation error");
    errorResponse(res, "Invalid database query.", [], 400);
    return;
  }

  // 4. Unhandled / unexpected errors
  logger.error({ err }, "unhandled error");
  errorResponse(
    res,
    env.node_env === "production" ? "An unexpected error occurred." : err.message,
    [],
    500,
  );
};
