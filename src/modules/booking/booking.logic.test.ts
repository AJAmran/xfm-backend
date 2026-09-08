import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeExpectedPax,
  computePaxSummary,
  isValidStatusTransition,
  buildWarningsForBooking,
} from "./booking.logic.js";
import { updateBookingSchema } from "./booking.validation.js";
import { resolveBranchScope } from "../../utils/accessScope.js";

describe("initial pax immutability", () => {
  it("update schema rejects initialPax (strict, immutable forever)", () => {
    const parsed = updateBookingSchema.safeParse({ guestName: "A", initialPax: 999 });
    assert.equal(parsed.success, false);
  });

  it("update schema accepts guest-only edits", () => {
    const parsed = updateBookingSchema.safeParse({ guestName: "Karim", guestMobile: "01700000000" });
    assert.equal(parsed.success, true);
  });
});

describe("pax adjustments", () => {
  it("computes expected pax from spec example: 100 +20 -5 +10 = 125", () => {
    assert.equal(
      computeExpectedPax(100, [
        { type: "INCREASE", quantity: 20 },
        { type: "DECREASE", quantity: 5 },
        { type: "INCREASE", quantity: 10 },
      ]),
      125,
    );
  });

  it("summarizes increase/decrease/expected/variance", () => {
    const s = computePaxSummary(
      100,
      [
        { type: "INCREASE", quantity: 20 },
        { type: "DECREASE", quantity: 5 },
      ],
      108,
    );
    assert.equal(s.totalIncrease, 20);
    assert.equal(s.totalDecrease, 5);
    assert.equal(s.expectedPax, 115);
    assert.equal(s.actualPax, 108);
    assert.equal(s.variance, -7);
  });

  it("variance is null until actual pax is entered", () => {
    const s = computePaxSummary(100, [], null);
    assert.equal(s.expectedPax, 100);
    assert.equal(s.variance, null);
  });
});

describe("branch isolation", () => {
  it("forces branch manager to own branch", () => {
    assert.equal(resolveBranchScope(undefined, { role: "BRANCH_MANAGER", branchId: 5 }), 5);
    assert.throws(() => resolveBranchScope(7, { role: "BRANCH_MANAGER", branchId: 5 }), /own branch/);
  });

  it("requires explicit branchId for admins", () => {
    assert.throws(() => resolveBranchScope(undefined, { role: "ADMIN", branchId: null }), /branchId is required/);
    assert.equal(resolveBranchScope(3, { role: "ADMIN", branchId: null }), 3);
  });
});

describe("status transitions", () => {
  it("allows TENTATIVE -> CONFIRMED -> COMPLETED and cancellations", () => {
    assert.equal(isValidStatusTransition("TENTATIVE", "CONFIRMED"), true);
    assert.equal(isValidStatusTransition("TENTATIVE", "CANCELLED"), true);
    assert.equal(isValidStatusTransition("CONFIRMED", "COMPLETED"), true);
    assert.equal(isValidStatusTransition("CONFIRMED", "CANCELLED"), true);
  });

  it("rejects illegal and terminal transitions", () => {
    assert.equal(isValidStatusTransition("TENTATIVE", "COMPLETED"), false);
    assert.equal(isValidStatusTransition("TENTATIVE", "TENTATIVE"), false);
    assert.equal(isValidStatusTransition("CANCELLED", "CONFIRMED"), false);
    assert.equal(isValidStatusTransition("COMPLETED", "CONFIRMED"), false);
    assert.equal(isValidStatusTransition("CONFIRMED", "TENTATIVE"), false);
  });
});

describe("smart warnings", () => {
  const base = {
    id: 1,
    bookingNumber: "BK-20260906-ABCDEF",
    branchId: 5,
    branchCode: "X-05",
    guestName: "Rahim",
    partyDate: "2026-09-07",
    partyType: "DINNER",
    status: "CONFIRMED" as const,
    initialPax: 100,
    expectedPax: 100,
    actualPax: null as number | null,
    branchCapacity: 300,
    today: "2026-09-06",
  };

  it("flags tomorrow TENTATIVE as CRITICAL", () => {
    const w = buildWarningsForBooking({ ...base, status: "TENTATIVE" });
    assert.ok(w.some((x) => x.code === "TENTATIVE_TOMORROW" && x.level === "CRITICAL"));
  });

  it("flags capacity breach as CRITICAL", () => {
    const w = buildWarningsForBooking({ ...base, expectedPax: 340 });
    assert.ok(w.some((x) => x.code === "EXCEEDS_CAPACITY" && x.level === "CRITICAL"));
  });

  it("flags +50% pax growth as WARNING", () => {
    const w = buildWarningsForBooking({ ...base, expectedPax: 150 });
    assert.ok(w.some((x) => x.code === "PAX_INCREASED_SIGNIFICANTLY"));
  });

  it("flags missing actual pax after event", () => {
    const w = buildWarningsForBooking({ ...base, partyDate: "2026-09-01" });
    assert.ok(w.some((x) => x.code === "ACTUAL_PAX_MISSING"));
  });

  it("flags actual pax 20%+ over expected", () => {
    const w = buildWarningsForBooking({ ...base, actualPax: 135 });
    assert.ok(w.some((x) => x.code === "ACTUAL_PAX_HIGHER"));
  });

  it("stays quiet for a healthy booking", () => {
    assert.equal(buildWarningsForBooking(base).length, 0);
  });
});
