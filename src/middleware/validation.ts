import { Request, Response, NextFunction } from "express";
import { validationError } from "../utils/appError";
import { ZodSchema, ZodError } from "zod";

interface ValidationTarget {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export const validateSchema = (target: ValidationTarget) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (target.body) {
        const parsed = target.body.parse(req.body);
        req.body = parsed;
        res.locals.validatedBody = parsed;
      }
      if (target.query) {
        const parsed = target.query.parse(req.query);
        Object.defineProperty(req, "query", { value: parsed, writable: true, configurable: true });
        res.locals.validatedQuery = parsed;
      }
      if (target.params) {
        const parsed = target.params.parse(req.params);
        req.params = parsed as typeof req.params;
        res.locals.validatedParams = parsed;
      }
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

export function parsedQuery<T>(res: Response): T {
  return res.locals.validatedQuery as T;
}

export function parsedBody<T>(res: Response): T {
  return res.locals.validatedBody as T;
}
