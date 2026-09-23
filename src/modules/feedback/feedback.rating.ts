/**
 * Overall-rating derivation (business rule).
 *
 * "Overall Rating is calculated from the arithmetic mean of all non-empty
 *  category ratings. Unanswered categories are excluded from the
 *  calculation."
 *
 * Guests rate Food / Service / Environment / Event on the stored 5-point
 * scale (5=Excellent … 1=Very Poor). For the calculation each rated value
 * is normalised to a 4-point score (Excellent=4 … Poor=1), averaged, and
 * mapped back to a label:
 *
 *   3.50 – 4.00 → Excellent
 *   2.50 – 3.49 → Good
 *   1.50 – 2.49 → Average
 *   1.00 – 1.49 → Poor
 *
 * The label is stored using the same integers as the category ratings
 * (Excellent=5, Good=4, Average=3, Poor=2) so every downstream consumer
 * (analytics averages, NPS promoters/detractors, badges, filters) keeps
 * working unchanged. No rated categories → null (never 0, so reports
 * can't mistake it for "Poor").
 */

export type OverallLabel = "EXCELLENT" | "GOOD" | "AVERAGE" | "POOR";

const LABEL_TO_STORED: Record<OverallLabel, number> = {
  EXCELLENT: 5,
  GOOD: 4,
  AVERAGE: 3,
  POOR: 2,
};

function toScore(stored: number): number {
  if (stored >= 5) return 4;
  if (stored === 4) return 3;
  if (stored === 3) return 2;
  return 1;
}

export function averageToLabel(average: number): OverallLabel {
  if (average >= 3.5) return "EXCELLENT";
  if (average >= 2.5) return "GOOD";
  if (average >= 1.5) return "AVERAGE";
  return "POOR";
}

export interface CategoryRatings {
  foodRating?: number | null;
  serviceRating?: number | null;
  environmentRating?: number | null;
  eventRating?: number | null;
}

/**
 * Derives the stored overall rating (5–2) from the rated categories,
 * or null when nothing was rated.
 */
export function calculateOverallRating(ratings: CategoryRatings): number | null {
  const scores = [ratings.foodRating, ratings.serviceRating, ratings.environmentRating, ratings.eventRating]
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .map(toScore);

  if (scores.length === 0) return null;

  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return LABEL_TO_STORED[averageToLabel(average)];
}
