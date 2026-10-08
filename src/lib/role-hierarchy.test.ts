import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_HIERARCHY_RANK,
  canActOnRole,
  hierarchyRank,
} from "./role-hierarchy.js";

describe("canActOnRole — privilege escalation guard", () => {
  it("lets an account administer its own rank and everyone below it", () => {
    assert.equal(canActOnRole("ADMIN", "ADMIN"), true);
    assert.equal(canActOnRole("ADMIN", "MANAGER"), true);
    assert.equal(canActOnRole("ADMIN", "BRANCH_MANAGER"), true);
    assert.equal(canActOnRole("SUPER_ADMIN", "SUPER_ADMIN"), true);
    assert.equal(canActOnRole("SUPER_ADMIN", "BRANCH_MANAGER"), true);
  });

  it("stops an account minting or editing anyone senior to itself", () => {
    // The escalation this exists to block: an ADMIN with user-administration
    // rights creates a COO, sets its password, and is now a COO.
    assert.equal(canActOnRole("ADMIN", "COO"), false);
    assert.equal(canActOnRole("ADMIN", "MD"), false);
    assert.equal(canActOnRole("ADMIN", "DIRECTOR"), false);
    assert.equal(canActOnRole("ADMIN", "SUPER_ADMIN"), false);
    assert.equal(canActOnRole("COO", "MD"), false);
    assert.equal(canActOnRole("DIRECTOR", "COO"), false);
    assert.equal(canActOnRole("BRANCH_MANAGER", "MANAGER"), false);
  });

  it("fails closed when either role is unknown to the table", () => {
    // A caller we cannot rank gets no grant power, and a role nobody has
    // ranked yet cannot be handed out until somebody decides where it sits.
    assert.equal(canActOnRole("BRAND_NEW_ROLE", "BRANCH_MANAGER"), false);
    assert.equal(canActOnRole("ADMIN", "BRAND_NEW_ROLE"), false);
  });

  it("treats equal rank as permissible — admins administer admins", () => {
    for (const role of Object.keys(ROLE_HIERARCHY_RANK)) {
      assert.equal(canActOnRole(role, role), true, `${role} should equal itself`);
    }
  });
});

describe("role hierarchy table", () => {
  it("is strictly ordered and covers every rank exactly once", () => {
    const ranks: number[] = Object.values(ROLE_HIERARCHY_RANK);
    assert.equal(new Set(ranks).size, ranks.length, "duplicate rank values");
    // Iterated rather than indexed: `noUncheckedIndexedAccess` types `ranks[i]`
    // as `number | undefined`, which would defeat the point of the assertion.
    let previous = Number.NEGATIVE_INFINITY;
    for (const rank of ranks) {
      assert.ok(rank > previous, `ranks must be strictly increasing (saw ${rank} after ${previous})`);
      previous = rank;
    }
  });

  it("ranks unknown roles as most senior (approval-ordering direction)", () => {
    assert.equal(hierarchyRank("BRAND_NEW_ROLE"), Number.MAX_SAFE_INTEGER);
  });
});
