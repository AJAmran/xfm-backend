import { z } from "zod";

export const analyticsQuerySchema = z.object({}).strict();

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
