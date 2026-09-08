/**
 * Pure business logic for the Booking Management System.
 * No DB / framework imports — safe to unit-test with node --test.
 */

export type BookingStatusValue = "TENTATIVE" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
export type PaxAdjustmentKind = "INCREASE" | "DECREASE";

export interface PaxAdjustmentLike {
  type: PaxAdjustmentKind;
  quantity: number;
}

export interface PaxSummary {
  initialPax: number;
  totalIncrease: number;
  totalDecrease: number;
  expectedPax: number;
  actualPax: number | null;
  /** actualPax - expectedPax (null when actual not entered yet) */
  variance: number | null;
}

/** Expected Pax = Initial Pax + sum(signed adjustments). */
export function computeExpectedPax(initialPax: number, adjustments: PaxAdjustmentLike[]): number {
  let expected = initialPax;
  for (const adj of adjustments) {
    expected += adj.type === "INCREASE" ? adj.quantity : -adj.quantity;
  }
  return expected;
}

export function computePaxSummary(
  initialPax: number,
  adjustments: PaxAdjustmentLike[],
  actualPax: number | null | undefined,
): PaxSummary {
  let totalIncrease = 0;
  let totalDecrease = 0;
  for (const adj of adjustments) {
    if (adj.type === "INCREASE") totalIncrease += adj.quantity;
    else totalDecrease += adj.quantity;
  }
  const expectedPax = initialPax + totalIncrease - totalDecrease;
  const actual = actualPax ?? null;
  return {
    initialPax,
    totalIncrease,
    totalDecrease,
    expectedPax,
    actualPax: actual,
    variance: actual === null ? null : actual - expectedPax,
  };
}

/** Allowed status transitions. CANCELLED/COMPLETED are terminal. */
const ALLOWED_TRANSITIONS: Record<BookingStatusValue, BookingStatusValue[]> = {
  TENTATIVE: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "COMPLETED"],
  CANCELLED: [],
  COMPLETED: [],
};

export function isValidStatusTransition(from: BookingStatusValue, to: BookingStatusValue): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Warnings ────────────────────────────────────────────────────────────────

export type WarningLevel = "INFO" | "WARNING" | "CRITICAL";

export interface BookingWarningInput {
  id: number;
  bookingNumber: string;
  branchId: number;
  branchCode?: string;
  branchName?: string;
  guestName: string;
  partyDate: string; // YYYY-MM-DD
  partyType: string;
  status: BookingStatusValue;
  initialPax: number;
  expectedPax: number;
  actualPax: number | null;
  branchCapacity: number | null;
  /** YYYY-MM-DD in UTC */
  today: string;
}

export interface BookingWarning {
  bookingId: number;
  bookingNumber: string;
  branchId: number;
  branchCode?: string;
  level: WarningLevel;
  code:
    | "TENTATIVE_TOMORROW"
    | "PAX_INCREASED_SIGNIFICANTLY"
    | "EXCEEDS_CAPACITY"
    | "ACTUAL_PAX_MISSING"
    | "ACTUAL_PAX_HIGHER";
  message: string;
}

function toDayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/**
 * Computes operational warnings for a single booking.
 * Thresholds mirror the spec: +50% pax growth, actual 20%+ over expected.
 */
export function buildWarningsForBooking(b: BookingWarningInput): BookingWarning[] {
  const warnings: BookingWarning[] = [];
  const base = {
    bookingId: b.id,
    bookingNumber: b.bookingNumber,
    branchId: b.branchId,
    branchCode: b.branchCode,
  };
  const todayN = toDayNumber(b.today);
  const partyN = toDayNumber(b.partyDate);
  const dayDiff = Math.round((partyN - todayN) / 86400000);

  // 1. Tomorrow's booking still TENTATIVE → CRITICAL
  if (b.status === "TENTATIVE" && dayDiff === 1) {
    warnings.push({
      ...base,
      level: "CRITICAL",
      code: "TENTATIVE_TOMORROW",
      message: `Booking ${b.bookingNumber} (${b.guestName}) is still Tentative for tomorrow.`,
    });
  }

  // 2. Significant pax increase: +50% or more over initial → WARNING
  if (b.initialPax > 0 && b.expectedPax >= b.initialPax * 1.5 && b.status !== "CANCELLED") {
    warnings.push({
      ...base,
      level: "WARNING",
      code: "PAX_INCREASED_SIGNIFICANTLY",
      message: `Pax increased by ${b.expectedPax - b.initialPax} (initial ${b.initialPax} → expected ${b.expectedPax}) for booking ${b.bookingNumber}.`,
    });
  }

  // 3. Expected pax exceeds branch capacity → CRITICAL
  if (b.branchCapacity != null && b.expectedPax > b.branchCapacity && b.status !== "CANCELLED") {
    warnings.push({
      ...base,
      level: "CRITICAL",
      code: "EXCEEDS_CAPACITY",
      message: `Expected pax ${b.expectedPax} exceeds branch capacity ${b.branchCapacity} for booking ${b.bookingNumber}.`,
    });
  }

  // 4. Actual pax missing after event (party date passed, not cancelled) → WARNING
  if (b.actualPax == null && dayDiff < 0 && (b.status === "CONFIRMED" || b.status === "COMPLETED")) {
    warnings.push({
      ...base,
      level: "WARNING",
      code: "ACTUAL_PAX_MISSING",
      message: `Actual pax entry is missing for booking ${b.bookingNumber} (party was ${b.partyDate}).`,
    });
  }

  // 5. Actual pax significantly higher than expected (20%+) → WARNING
  if (b.actualPax != null && b.expectedPax > 0 && b.actualPax >= Math.ceil(b.expectedPax * 1.2)) {
    warnings.push({
      ...base,
      level: "WARNING",
      code: "ACTUAL_PAX_HIGHER",
      message: `Actual pax ${b.actualPax} is significantly higher than expected ${b.expectedPax} for booking ${b.bookingNumber}.`,
    });
  }

  return warnings;
}

export function buildWarningsForBookings(list: BookingWarningInput[]): BookingWarning[] {
  return list.flatMap(buildWarningsForBooking);
}
