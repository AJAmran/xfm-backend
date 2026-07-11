import { Request, Response, NextFunction } from "express";

/**
 * Lightweight request logger that records method, URL, status code,
 * and response time. Hooks into the 'finish' event so the status code
 * is captured after the response is sent.
 *
 * Uses process.hrtime.bigint() for sub-millisecond precision without
 * the overhead of Date.now() string allocation on every request.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const status = res.statusCode;
    const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";
    const timestamp = new Date().toISOString();

    console.log(
      `[${timestamp}] ${level} ${req.method} ${req.url} ${status} — ${durationMs.toFixed(2)}ms — IP: ${ip}`,
    );
  });

  next();
};