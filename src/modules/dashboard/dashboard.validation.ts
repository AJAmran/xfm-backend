import { z } from "zod";

export const dashboardQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}).strict();

export type DashboardQueryInput = z.infer<typeof dashboardQuerySchema>;
