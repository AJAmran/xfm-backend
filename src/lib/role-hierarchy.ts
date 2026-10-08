/**
 * Role seniority — the single source of truth for "who outranks whom".
 *
 * Lives outside any domain module on purpose: the document workflow needs it to
 * validate approval sequences, and the user module needs it to stop a caller
 * granting a role senior to their own. `document.logic` re-exports it so its
 * existing import surface is unchanged.
 *
 * Lower number = more junior.
 *
 * BRANCH_MANAGER runs a branch outlet. MANAGER is a corporate department
 * manager/head, DIRECTOR is corporate leadership, COO is the general-manager
 * tier, MD is the final authority and SUPER_ADMIN is the top administrative
 * authority (it outranks MD so a system-administrator escalation path also
 * satisfies junior-to-senior).
 *
 * Every pre-existing relative order is preserved: the new roles were inserted as
 * extra rungs rather than re-numbering, so approval chains built before those
 * changes still validate exactly as before.
 */
export const ROLE_HIERARCHY_RANK = {
  BRANCH_MANAGER: 10,
  MANAGER: 15,
  ADMIN: 20,
  DIRECTOR: 25,
  COO: 30,
  MD: 40,
  SUPER_ADMIN: 50,
} as const satisfies Record<string, number>;

export type RankedRole = keyof typeof ROLE_HIERARCHY_RANK;

/**
 * Rank for an arbitrary role string. Unknown roles sort as most senior so a
 * newly added role never blocks a sequence by accident.
 *
 * Note the asymmetry with permission checks: unknown roles are treated as SENIOR
 * here (fail-safe for approval ordering) but must be treated as NO-PERMISSION
 * elsewhere (fail-closed for access control). Never reuse one decision for the
 * other.
 */
export function hierarchyRank(role: string): number {
  return ROLE_HIERARCHY_RANK[role as RankedRole] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Whether `callerRole` may grant, modify or act upon `targetRole`.
 *
 * A caller may never reach above their own rank. This is what stops an
 * account with user-administration rights minting a COO/MD (and setting its
 * password) — a self-service privilege escalation that the previous
 * SUPER_ADMIN-only guard did not cover.
 *
 * Equal rank is allowed: an ADMIN still administers other ADMINs.
 *
 * Deliberately fails CLOSED for either side being unknown: a caller whose own
 * role is missing from the table gets no grant power, and a role nobody has
 * ranked yet cannot be handed out until somebody decides where it sits.
 * (`hierarchyRank` itself ranks unknown roles as most senior, so it must NOT be
 * reused here — that direction fails open.)
 */
export function canActOnRole(callerRole: string, targetRole: string): boolean {
  // Widened to `Record<string, number>` so an unranked key reads back as
  // `undefined` instead of being narrowed to the literal union by `as const`.
  const table: Record<string, number> = ROLE_HIERARCHY_RANK;
  const caller = table[callerRole];
  const target = table[targetRole];
  if (caller === undefined || target === undefined) return false;
  return target <= caller;
}
