import { Request, Response } from "express";

/** JSON 404 for unknown API routes — mounted after all routers but
 *  BEFORE the global error handler (Express runs notFound first). */
export function notFound(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    message: "Route not found",
    errors: [{ field: "path", message: `${req.method} ${req.path} does not exist` }],
  });
}
