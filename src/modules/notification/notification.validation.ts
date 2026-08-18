import { z } from "zod";

export const notificationQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("20"),
  unreadOnly: z.enum(["true", "false"]).optional(),
}).strict();

export const notificationIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "Invalid notification id"),
}).strict();

export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>;
