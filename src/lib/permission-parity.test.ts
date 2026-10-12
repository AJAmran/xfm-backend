import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  ROLE_PERMISSIONS,
  ROLE_SLUGS,
  roleKeys,
  type PermissionKey,
} from "./permission-catalog.js";

/**
 * Permission parity — the catalog must replicate today's runtime guards.
 *
 * Derived from auditing every `authGuard`/`writeGuard`/`adminGuard` usage
 * plus every literal role comparison in `src/` (Oct 2026). These tests are
 * the contract for Phase 2: the moment a route is switched to
 * `requirePermission`, THIS table is what the guard enforces — so if a value
 * here is wrong, Phase 2 ships a behaviour change. Any intentional
 * difference must update this file deliberately (and the seed follows it).
 */

const has = (role: keyof typeof ROLE_PERMISSIONS, key: PermissionKey): boolean =>
  roleKeys(role).includes(key);

describe("permission catalog shape", () => {
  it("covers every role exactly once, with slugs", () => {
    const roles = Object.keys(ROLE_PERMISSIONS).sort();
    assert.deepEqual(roles, [
      "ADMIN",
      "BRANCH_MANAGER",
      "COO",
      "DIRECTOR",
      "DOCUMENT_OFFICER",
      "MANAGER",
      "MD",
      "SUPER_ADMIN",
    ]);
    for (const role of roles) assert.ok(ROLE_SLUGS[role as keyof typeof ROLE_SLUGS]);
  });

  it("every key is a known resource.action pair, unique per role", () => {
    const resources = new Set<string>(PERMISSION_RESOURCES);
    const actions = new Set<string>(PERMISSION_ACTIONS);
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      assert.equal(new Set(keys).size, keys.length, `${role} has duplicate keys`);
      for (const key of keys) {
        const dot = key.indexOf(".");
        assert.ok(dot > 0, `${role}: malformed key ${key}`);
        const resource = key.slice(0, dot);
        const action = key.slice(dot + 1);
        assert.ok(resources.has(resource), `${role}: unknown resource in ${key}`);
        assert.ok(actions.has(action), `${role}: unknown action in ${key}`);
      }
    }
  });

  it("role sizes match the audited guard sets (drift alarm)", () => {
    assert.equal(roleKeys("SUPER_ADMIN").length, 45);
    assert.equal(roleKeys("ADMIN").length, 43);
    assert.equal(roleKeys("DIRECTOR").length, 9);
    assert.equal(roleKeys("MANAGER").length, 9);
    assert.equal(roleKeys("DOCUMENT_OFFICER").length, 9);
    assert.equal(roleKeys("COO").length, 31);
    assert.equal(roleKeys("MD").length, 14);
    assert.equal(roleKeys("BRANCH_MANAGER").length, 28);
  });
});

describe("system-role parity with today's guards", () => {
  it("SUPER_ADMIN holds the two admin-only keys", () => {
    assert.equal(has("SUPER_ADMIN", "settings.manage"), true);
    assert.equal(has("SUPER_ADMIN", "document.manage"), true);
    assert.equal(has("SUPER_ADMIN", "user.manage"), true);
  });

  it("ADMIN has user/branch administration but no settings or document admin", () => {
    assert.equal(has("ADMIN", "user.manage"), true);
    assert.equal(has("ADMIN", "branch.delete"), true);
    assert.equal(has("ADMIN", "inventory_catalog.delete"), true);
    assert.equal(has("ADMIN", "settings.manage"), false);
    assert.equal(has("ADMIN", "document.manage"), false);
  });

  it("DIRECTOR and MANAGER share the documents-only corporate surface", () => {
    assert.deepEqual(ROLE_PERMISSIONS.MANAGER, ROLE_PERMISSIONS.DIRECTOR);
    // DOCUMENT_OFFICER is the same surface by design (department heads who
    // process documents and nothing else).
    assert.deepEqual(ROLE_PERMISSIONS.DOCUMENT_OFFICER, ROLE_PERMISSIONS.MANAGER);
    for (const key of ["document.create", "document.edit", "document.delete", "approval.view"] as const) {
      assert.equal(has("DIRECTOR", key), true);
    }
    for (const key of ["feedback.view", "report.view", "user.view", "branch.view", "document.manage"] as const) {
      assert.equal(has("DIRECTOR", key), false);
    }
  });

  it("COO reads everywhere executives read, writes operations, approves", () => {
    for (const key of [
      "report.view",
      "branch.view",
      "booking.delete",
      "inventory.edit",
      "guest_offer.manage",
      "manager_report.manage",
      "document.edit",
    ] as const) {
      assert.equal(has("COO", key), true);
    }
    for (const key of ["user.view", "branch.delete", "inventory_catalog.view", "document.manage", "settings.manage"] as const) {
      assert.equal(has("COO", key), false);
    }
  });

  it("MD is read-only, including document + approval reads the backend admits", () => {
    assert.equal(has("MD", "document.view"), true);
    assert.equal(has("MD", "approval.view"), true);
    assert.equal(has("MD", "branch.view"), true);
    for (const key of ["booking.create", "guest_offer.edit", "document.edit", "manager_report.delete"] as const) {
      assert.equal(has("MD", key), false);
    }
  });

  it("BRANCH_MANAGER writes operations but never catalog, master data or approvals", () => {
    assert.equal(has("BRANCH_MANAGER", "booking.create"), true);
    assert.equal(has("BRANCH_MANAGER", "inventory.edit"), true);
    assert.equal(has("BRANCH_MANAGER", "document.delete"), true);
    for (const key of [
      "inventory_catalog.view",
      "branch.view",
      "user.view",
      "guest_offer.manage",
      "manager_report.manage",
      "settings.manage",
    ] as const) {
      assert.equal(has("BRANCH_MANAGER", key), false);
    }
  });

  it("everybody sees the dashboard shell, settings text and their own bell", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      assert.equal(has(role, "dashboard.view"), true, role);
      assert.equal(has(role, "settings.view"), true, role);
      assert.equal(has(role, "notification.manage"), true, role);
    }
  });
});
