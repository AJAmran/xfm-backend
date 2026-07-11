import { Request, Response, NextFunction } from "express";
import { validationError } from "../utils/appError";
import { ZodSchema, ZodError } from "zod";

interface ValidationTarget {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export const validateSchema = (target: ValidationTarget) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (target.body) req.body = target.body.parse(req.body);
      if (target.query) req.query = target.query.parse(req.query) as typeof req.query;
      if (target.params) req.params = target.params.parse(req.params) as typeof req.params;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(validationError("Input validation failed", error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }))));
        return;
      }
      next(error);
    }
  };
};
