import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const status = res.statusCode;

    const logData = {
      method: req.method,
      url: req.url,
      statusCode: status,
      durationMs: Math.round(durationMs * 100) / 100,
      ip,
    };

    if (status >= 500) logger.error(logData, "request failed");
    else if (status >= 400) logger.warn(logData, "request warning");
    else logger.info(logData, "request completed");
  });

  next();
};