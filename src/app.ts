import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import env from "./config/env";
import { requestLogger } from "./middleware/logger";
import { globalErrorHandler } from "./middleware/errorHandler";
import { globalLimiter } from "./middleware/rateLimiter";
import { AuthRoutes } from "./modules/auth/auth.route";
import { UserRoutes } from "./modules/user/user.routes";
import { BranchRoutes } from "./modules/branch/branch.routes";
import { FeedbackRoutes } from "./modules/feedback/feedback.routes";
import { DashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { AnalyticsRoutes } from "./modules/analytics/analytics.routes";
import { ReportsRoutes } from "./modules/reports/reports.routes";
import { SettingsRoutes } from "./modules/settings/settings.routes";

const app: Application = express();

app.use(helmet());

app.use(cors({ origin: env.app_url, credentials: true }));

app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

app.use(compression());

app.use(requestLogger);

// app.use(globalLimiter);

app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: "v1",
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

app.use(globalErrorHandler);

export default app;
