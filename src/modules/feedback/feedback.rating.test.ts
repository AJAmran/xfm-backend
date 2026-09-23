import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateOverallRating, averageToLabel } from "./feedback.rating";

describe("overall rating derivation", () => {
  // Stored scale: 5=Excellent, 4=Good, 3=Average, 2=Poor.
  it("(E,G,A,—) → (4+3+2)/3 = 3 → Good (4)", () => {
    assert.equal(
      calculateOverallRating({ foodRating: 5, serviceRating: 4, environmentRating: 3 }),
      4,
    );
  });

  it("(E,E,—,—) → 4 → Excellent (5)", () => {
    assert.equal(calculateOverallRating({ foodRating: 5, serviceRating: 5 }), 5);
  });

  it("(G,A,—,—) → 2.5 → Good (4)", () => {
    assert.equal(
      calculateOverallRating({ foodRating: 4, serviceRating: 3 }),
      4,
    );
  });

  it("(P,A,—,—) → 1.5 → Average (3)", () => {
    assert.equal(
      calculateOverallRating({ foodRating: 2, serviceRating: 3 }),
      3,
    );
  });

  it("(E,—,—,—) → Excellent (5)", () => {
    assert.equal(calculateOverallRating({ foodRating: 5 }), 5);
  });

  it("(E,G,—,—) → 3.5 → Excellent (5): empty fields excluded, not zeroed", () => {
    assert.equal(
      calculateOverallRating({ foodRating: 5, serviceRating: 4 }),
      5,
    );
  });

  it("(—,—,—,—) → null, never 0", () => {
    assert.equal(calculateOverallRating({}), null);
    assert.equal(
      calculateOverallRating({
        foodRating: null,
        serviceRating: null,
        environmentRating: null,
        eventRating: null,
      }),
      null,
    );
  });

  it("range boundaries", () => {
    assert.equal(averageToLabel(4.0), "EXCELLENT");
    assert.equal(averageToLabel(3.5), "EXCELLENT");
    assert.equal(averageToLabel(3.49), "GOOD");
    assert.equal(averageToLabel(2.5), "GOOD");
    assert.equal(averageToLabel(2.49), "AVERAGE");
    assert.equal(averageToLabel(1.5), "AVERAGE");
    assert.equal(averageToLabel(1.49), "POOR");
    assert.equal(averageToLabel(1.0), "POOR");
  });
});
