import type { Role } from "../../generated/prisma/enums";

/**
 * Permission catalog — the single source of truth for "which role may do what".
 *
 * A permission is a `resource.action` key (e.g. `user.create`,
 * `document.manage`). Resources are backend modules; actions are the five verbs
 * the admin matrix offers:
 *
 * - `view`   read/list a module
 * - `create` add new rows (documents, bookings, reports, items…)
 * - `edit`   change existing rows (including approve/reject on documents)
 * - `delete` remove rows (soft-delete where the module supports it)
 * - `manage` module-level administration that is deliberately NOT covered by
 *   create/edit/delete: assigning user roles, document types + policy + SLA
 *   sweeps, settings writes, guest-offer / manager-report approval decisions
 *
 * Two resources exist only to preserve exact parity with today's guards:
 * `inventory_catalog` (catalog items + categories are SUPER_ADMIN/ADMIN only,
 * while statements follow the wider writeGuard set) and the `manage` verb on
 * guest offers / manager reports (their approval endpoints exclude
 * BRANCH_MANAGER while the write endpoints include them).
 *
 * `ROLE_PERMISSIONS` below replicates today's runtime behaviour, derived from
 * auditing every `authGuard`/`writeGuard`/`adminGuard` usage and every literal
 * role comparison in `src/`. It feeds BOTH the seed script
 * (`prisma/seed-role-permissions.ts`) and the parity test
 * (`src/lib/permission-parity.test.ts`), so the seed and the test can never
 * drift apart.
 *
 * Branch scoping is intentionally OUT of this table: `feedback.view` on a
 * BRANCH_MANAGER account is still scoped to their `branchId` by the feedback
 * service. Permission = may touch the module; scope = which rows.
 */

export const PERMISSION_RESOURCES = [
  "dashboard",
  "feedback",
  "analytics",
  "report",
  "branch",
  "user",
  "booking",
  "inventory",
  "inventory_catalog",
  "guest_offer",
  "manager_report",
  "document",
  "approval",
  "settings",
  "notification",
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete", "manage"] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type PermissionKey = `${PermissionResource}.${PermissionAction}`;

export const ROLE_SLUGS: Record<Role, string> = {
  SUPER_ADMIN: "super-admin",
  ADMIN: "admin",
  DIRECTOR: "director",
  MANAGER: "manager",
  DOCUMENT_OFFICER: "document-officer",
  BRANCH_MANAGER: "branch-manager",
  COO: "coo",
  MD: "md",
};

const READ: PermissionKey[] = [
  "dashboard.view",
  "feedback.view",
  "analytics.view",
  "report.view",
];

const CORPORATE_DOCS: PermissionKey[] = [
  "document.view",
  "document.create",
  "document.edit",
  "document.delete",
  "approval.view",
];

const WRITE_MODULES: PermissionKey[] = [
  "booking.view",
  "booking.create",
  "booking.edit",
  "booking.delete",
  "inventory.view",
  "inventory.create",
  "inventory.edit",
  "inventory.delete",
  "guest_offer.view",
  "guest_offer.create",
  "guest_offer.edit",
  "guest_offer.delete",
  "manager_report.view",
  "manager_report.create",
  "manager_report.edit",
  "manager_report.delete",
];

const APPROVAL_MANAGE: PermissionKey[] = ["guest_offer.manage", "manager_report.manage"];

const BELL: PermissionKey[] = ["notification.view", "notification.manage"];

export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  // Full access (explicit rows; the guard layer additionally treats
  // SUPER_ADMIN as `*.*` so a new resource can never 403 the super admin).
  SUPER_ADMIN: [
    ...READ,
    "branch.view",
    "branch.create",
    "branch.edit",
    "branch.delete",
    "user.view",
    "user.create",
    "user.edit",
    "user.delete",
    "user.manage",
    ...WRITE_MODULES,
    "inventory_catalog.view",
    "inventory_catalog.create",
    "inventory_catalog.edit",
    "inventory_catalog.delete",
    ...APPROVAL_MANAGE,
    ...CORPORATE_DOCS,
    "document.manage",
    "settings.view",
    "settings.manage",
    ...BELL,
  ],

  // All ops + approvals, no Settings writes, no document administration.
  ADMIN: [
    ...READ,
    "branch.view",
    "branch.create",
    "branch.edit",
    "branch.delete",
    "user.view",
    "user.create",
    "user.edit",
    "user.delete",
    "user.manage",
    ...WRITE_MODULES,
    "inventory_catalog.view",
    "inventory_catalog.create",
    "inventory_catalog.edit",
    "inventory_catalog.delete",
    ...APPROVAL_MANAGE,
    ...CORPORATE_DOCS,
    "settings.view",
    ...BELL,
  ],

  // Corporate leadership tier: documents + approvals, nothing else.
  DIRECTOR: ["dashboard.view", ...CORPORATE_DOCS, "settings.view", ...BELL],

  // Corporate department tier: same surface as DIRECTOR by design.
  MANAGER: ["dashboard.view", ...CORPORATE_DOCS, "settings.view", ...BELL],

  // Document-processing tier: department heads who work documents and
  // nothing else. Same surface as MANAGER by design.
  DOCUMENT_OFFICER: ["dashboard.view", ...CORPORATE_DOCS, "settings.view", ...BELL],

  // Executive oversight: reads everywhere, writes on the daily-operation
  // modules, approval decisions, no master-data administration.
  COO: [
    ...READ,
    "branch.view",
    ...WRITE_MODULES,
    ...APPROVAL_MANAGE,
    ...CORPORATE_DOCS,
    "settings.view",
    ...BELL,
  ],

  // Read-only executive: views only, including document + approval reads
  // (the backend module guards admit MD for reads; the frontend hides the
  // approvals inbox and the Branches section by separate UI rules).
  MD: [
    ...READ,
    "branch.view",
    "booking.view",
    "inventory.view",
    "guest_offer.view",
    "manager_report.view",
    "document.view",
    "approval.view",
    "settings.view",
    ...BELL,
  ],

  // Single-branch operations, scoped to `branchId` by the services.
  BRANCH_MANAGER: [
    ...READ,
    ...WRITE_MODULES,
    ...CORPORATE_DOCS,
    "settings.view",
    ...BELL,
  ],
};

/**
 * Keys for a role, defensive against hand-edited sources: a role the catalog
 * does not know resolves to nothing (fail-closed), never to full access.
 */
export function roleKeys(role: string): PermissionKey[] {
  return (ROLE_PERMISSIONS as Record<string, PermissionKey[]>)[role] ?? [];
}
