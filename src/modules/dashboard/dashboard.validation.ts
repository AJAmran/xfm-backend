import { z } from "zod";

export const dashboardQuerySchema = z.object({}).strict();

export type DashboardQueryInput = z.infer<typeof dashboardQuerySchema>;
