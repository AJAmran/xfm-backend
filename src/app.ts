import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import env from "./config/env";
import { requestLogger } from "./middleware/logger";
import { globalErrorHandler } from "./middleware/errorHandler";
import { globalLimiter } from "./middleware/rateLimiter";
import { prisma } from "./lib/prisma";
import { AuthRoutes } from "./modules/auth/auth.route";
import { UserRoutes } from "./modules/user/user.routes";
import { BranchRoutes } from "./modules/branch/branch.routes";
import { FeedbackRoutes } from "./modules/feedback/feedback.routes";
import { DashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { AnalyticsRoutes } from "./modules/analytics/analytics.routes";
import { ReportsRoutes } from "./modules/reports/reports.routes";
import { SettingsRoutes } from "./modules/settings/settings.routes";
import { ManagerReportRoutes } from "./modules/manager-report/manager-report.routes";
import { GuestOfferRoutes } from "./modules/guest-offer/guest-offer.routes";
import { InventoryRoutes } from "./modules/inventory/inventory.routes";
import { RealtimeRoutes } from "./modules/realtime/realtime.routes";

const app: Application = express();

// Trust the first hop when deployed behind a reverse proxy (Vercel/nginx/PM2).
// Required so express-rate-limit keys off the real client IP, not the proxy's.
app.set("trust proxy", 1);

app.use(helmet());

const allowedOrigins = env.app_url.split(",").map((url) => url.trim().replace(/\/$/, ""));
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(cookieParser());
// 1mb body limit: feedback payloads are tiny, but inventory statements and
// manager reports legitimately ship many rows/lines in one request.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(compression({ filter: shouldCompress }));

/** Disable gzip for streaming routes (SSE must stream uncompressed). */
function shouldCompress(_req: Request, res: Response) {
  if (res.getHeader("Content-Type") === "text/event-stream") return false;
  return true;
}

app.use(requestLogger);

// Baseline distributed throttling: one velvet-rope for the whole API.
// SSE streams count once per connection (not per event), so realtime sync
// is unaffected; dashboard polling and bulk exports stay well under the cap.
app.use(globalLimiter);

app.get("/api/v1/health", async (_req: Request, res: Response) => {
  let dbStatus = "unhealthy";
  try {
    await prisma.$queryRaw<unknown[]>`SELECT 1`;
    dbStatus = "healthy";
  } catch {
    dbStatus = "unhealthy";
  }

  const statusCode = dbStatus === "healthy" ? 200 : 503;

  res.status(statusCode).json({
    success: dbStatus === "healthy",
    status: statusCode === 200 ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: "v1",
    database: dbStatus,
  });
});

app.get("/", (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: "X-Group Feedback Management System API",
    data: { version: "v1", health: "/api/v1/health" },
  });
});

const v1 = "/api/v1";

app.use(`${v1}/auth`, AuthRoutes);
app.use(`${v1}/users`, UserRoutes);
app.use(`${v1}/branches`, BranchRoutes);
app.use(`${v1}/feedbacks`, FeedbackRoutes);
app.use(`${v1}/dashboard`, DashboardRoutes);
app.use(`${v1}/analytics`, AnalyticsRoutes);
app.use(`${v1}/reports`, ReportsRoutes);
app.use(`${v1}/settings`, SettingsRoutes);
app.use(`${v1}/manager-reports`, ManagerReportRoutes);
app.use(`${v1}/guest-offers`, GuestOfferRoutes);
app.use(`${v1}/inventory`, InventoryRoutes);
app.use(`${v1}/realtime`, RealtimeRoutes);

app.use(globalErrorHandler);

export default app;
