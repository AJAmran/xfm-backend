import { z } from "zod";
import { HeardAbout, AgeGroup } from "../../../generated/prisma/enums";

const rating = z.number().int().min(3).max(5);

export const createFeedbackSchema = z.object({
  branchId: z.number().int().positive(),
  guestName: z.string().trim().min(1),
  contact: z.string().trim().optional(),
  foodRating: rating,
  serviceRating: rating,
  environmentRating: rating,
  eventRating: rating,
  overallRating: rating,
  heardAbout: z.nativeEnum(HeardAbout).optional(),
  ageGroup: z.nativeEnum(AgeGroup).optional(),
  opinion: z.string().trim().optional(),
});

export const feedbackQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  sortBy: z.string().optional().default("submittedAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  branchId: z.string().optional(),
  rating: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
export type FeedbackQueryInput = z.infer<typeof feedbackQuerySchema>;
