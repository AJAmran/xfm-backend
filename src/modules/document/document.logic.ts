/**
 * Pure business rules for the Document Approval & E-Signature module.
 *
 * No DB, framework, or environment imports — safe to unit-test with
 * `node --test` (see document.logic.test.ts). Everything that decides whether a
 * workflow may advance lives here so it can be reasoned about and tested
 * without a database.
 *
 * Hierarchy is derived from the ERP's existing `Role` enum rather than a
 * second org model, so no user/role administration changes are required.
 */

// Role seniority lives in `src/lib/role-hierarchy` because the user module needs
// the same table (to refuse granting a role above the caller's own rank).
// Re-exported below so the document module's import surface is unchanged.
// Pure — no DB, framework or environment, so the file stays unit-testable.
import { ROLE_HIERARCHY_RANK, hierarchyRank } from "../../lib/role-hierarchy";

export { ROLE_HIERARCHY_RANK, hierarchyRank };
export type { RankedRole } from "../../lib/role-hierarchy";

export type DocumentStatusValue =
  | "DRAFT"
  | "SUBMITTED"
  | "PENDING_APPROVAL"
  | "IN_REVIEW"
  | "RETURNED_FOR_REVISION"
  | "REJECTED"
  | "APPROVED"
  | "CANCELLED"
  | "EXPIRED"
  | "ARCHIVED";

export type WorkflowStepStatusValue =
  | "PENDING"
  | "ACTIVE"
  | "APPROVED"
  | "REJECTED"
  | "RETURNED_FOR_REVISION"
  | "SKIPPED";

export type ApprovalActionValue = "APPROVE_AND_SIGN" | "REJECT" | "REQUEST_CHANGES";

export type HierarchyPolicyValue = "NONE" | "JUNIOR_TO_SENIOR";

/** Roles that may never terminate a document as a silent discard. */
export const TERMINAL_STATUSES: DocumentStatusValue[] = [
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "ARCHIVED",
];

/** Statuses from which a creator may submit a document for approval. */
export const SUBMITTABLE_STATUSES: DocumentStatusValue[] = ["DRAFT", "RETURNED_FOR_REVISION", "REJECTED"];

/** Statuses in which the workflow engine expects an approver to act. */
export const IN_FLIGHT_STATUSES: DocumentStatusValue[] = ["PENDING_APPROVAL", "IN_REVIEW"];

/** Allowed document status transitions. Enforced by the backend engine only. */
const ALLOWED_TRANSITIONS: Record<DocumentStatusValue, DocumentStatusValue[]> = {
  DRAFT: ["SUBMITTED", "PENDING_APPROVAL", "CANCELLED"],
  SUBMITTED: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["IN_REVIEW", "RETURNED_FOR_REVISION", "REJECTED", "APPROVED", "CANCELLED"],
  IN_REVIEW: ["RETURNED_FOR_REVISION", "REJECTED", "APPROVED", "CANCELLED"],
  RETURNED_FOR_REVISION: ["SUBMITTED", "PENDING_APPROVAL", "CANCELLED"],
  REJECTED: ["SUBMITTED", "PENDING_APPROVAL", "CANCELLED"],
  APPROVED: ["ARCHIVED"],
  CANCELLED: [],
  EXPIRED: [],
  ARCHIVED: [],
};

export function isValidStatusTransition(
  from: DocumentStatusValue,
  to: DocumentStatusValue,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canSubmitDocument(status: DocumentStatusValue): boolean {
  return SUBMITTABLE_STATUSES.includes(status);
}

export function isTerminalDocument(status: DocumentStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Roles that may administer document types, policies and the audit log. */
export function canAdministerDocuments(role: string): boolean {
  return role === "SUPER_ADMIN";
}

/**
 * Roles granted blanket visibility over EVERY document.
 *
 * Single source of truth for the document module's oversight tier. `assertCanView`
 * and `getPaginatedDocuments` MUST agree on this: when they disagreed, corporate
 * staff (DIRECTOR/MANAGER) saw every document in the list but were refused 403
 * the moment they tried to open one they were not routed on.
 *
 * Deliberately excludes DIRECTOR and MANAGER — they participate in the workflow
 * as creators and approvers, they do not get to read every document in the
 * company.
 */
export function hasDocumentOversight(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "COO" || role === "MD";
}

// ─── Approver sequence policy ─────────────────────────────────────────────────

export interface ApproverCandidate {
  id: number;
  name: string;
  role: string;
}

export interface DocumentPolicy {
  hierarchyPolicy: HierarchyPolicyValue;
  minApprovers: number;
  maxApprovers: number;
  allowCreatorAsApprover: boolean;
  reminderAfterHours: number;
  escalateAfterHours: number;
  maxApprovalDays: number;
  requireSignature: boolean;
}

export const DEFAULT_DOCUMENT_POLICY: DocumentPolicy = {
  hierarchyPolicy: "JUNIOR_TO_SENIOR",
  minApprovers: 1,
  maxApprovers: 10,
  allowCreatorAsApprover: false,
  reminderAfterHours: 24,
  escalateAfterHours: 48,
  maxApprovalDays: 7,
  requireSignature: true,
};

export interface SequenceValidation {
  valid: boolean;
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
}

function fieldError(field: string, message: string) {
  return { field, message };
}

/**
 * Validates a user-proposed approval sequence against company policy.
 *
 * The user always controls the workflow; the system only enforces policy.
 * Violations are reported — the sequence is NEVER silently reordered.
 */
export function validateApprovalSequence(
  approverIds: number[],
  candidates: ApproverCandidate[],
  policy: DocumentPolicy,
  creatorId: number,
): SequenceValidation {
  const errors: { field: string; message: string }[] = [];
  const warnings: { field: string; message: string }[] = [];

  if (approverIds.length < policy.minApprovers) {
    errors.push(
      fieldError(
        "approverIds",
        `Company policy requires at least ${policy.minApprovers} approver${policy.minApprovers === 1 ? "" : "s"}`,
      ),
    );
  }

  if (!approverIds.length) {
    errors.push(fieldError("approverIds", "Select at least one approver before submitting"));
    return { valid: false, errors, warnings };
  }

  if (approverIds.length > policy.maxApprovers) {
    errors.push(
      fieldError(
        "approverIds",
        `Company policy allows at most ${policy.maxApprovers} approvers. Remove ${approverIds.length - policy.maxApprovers}.`,
      ),
    );
  }

  if (new Set(approverIds).size !== approverIds.length) {
    errors.push(fieldError("approverIds", "The same person cannot appear twice in the approval sequence"));
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  approverIds.forEach((id, index) => {
    if (!byId.has(id)) {
      errors.push(
        fieldError(`approverIds.${index}`, `Approver at position ${index + 1} is not an active user`),
      );
    }
  });

  // Block self-approval unless the policy explicitly permits it.
  if (!policy.allowCreatorAsApprover && approverIds.includes(creatorId)) {
    errors.push(
      fieldError("approverIds", "You cannot approve your own document. Remove yourself from the sequence."),
    );
  }

  // Any incomplete step above also makes rank comparison meaningless.
  if (errors.length) {
    return { valid: false, errors, warnings };
  }

  if (policy.hierarchyPolicy === "JUNIOR_TO_SENIOR") {
    for (let i = 0; i < approverIds.length - 1; i += 1) {
      const current = byId.get(approverIds[i]!)!;
      const next = byId.get(approverIds[i + 1]!)!;
      const currentRank = hierarchyRank(current.role);
      const nextRank = hierarchyRank(next.role);
      if (currentRank > nextRank) {
        errors.push(
          fieldError(
            `approverIds.${i + 1}`,
            `Hierarchy violation: ${current.name} (${current.role}) is more senior than the next approver ${next.name} (${next.role}). Company policy requires a junior-to-senior sequence.`,
          ),
        );
      }
      if (currentRank === nextRank) {
        warnings.push(
          fieldError(
            `approverIds.${i + 1}`,
            `${current.name} and ${next.name} are at the same level (${current.role}). Confirm this order is intended.`,
          ),
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Signature placement ──────────────────────────────────────────────────────

export interface SignaturePlacementInput {
  pageNumber: number;
  /** Percentages of page width (0-100) measured from the left edge. */
  x: number;
  /** Percentages of page height (0-100) measured from the top edge. */
  y: number;
  /** Percentages of page width. */
  width: number;
  /** Percentages of page height. */
  height: number;
}

export interface PlacementValidation {
  valid: boolean;
  errors: { field: string; message: string }[];
}

export const MIN_SIGNATURE_WIDTH_PCT = 8;
export const MIN_SIGNATURE_HEIGHT_PCT = 2;
export const MAX_SIGNATURE_WIDTH_PCT = 45;
export const MAX_SIGNATURE_HEIGHT_PCT = 20;

/**
 * Validates normalised signature coordinates.
 *
 * All values are percentages of the page box, so the same numbers render
 * identically on a phone, a laptop and the generated PDF regardless of zoom,
 * DPI or browser size.
 */
export function validateSignaturePlacement(
  placement: SignaturePlacementInput,
  pageCount: number | null,
): PlacementValidation {
  const errors: { field: string; message: string }[] = [];

  if (!Number.isFinite(placement.pageNumber) || placement.pageNumber < 1) {
    errors.push(fieldError("placement.pageNumber", "Select a valid page (starting at 1)"));
  }
  if (pageCount && placement.pageNumber > pageCount) {
    errors.push(
      fieldError("placement.pageNumber", `This document has ${pageCount} page${pageCount === 1 ? "" : "s"}`),
    );
  }

  for (const axis of ["x", "y", "width", "height"] as const) {
    if (!Number.isFinite(placement[axis])) {
      errors.push(fieldError(`placement.${axis}`, "Signature coordinates must be numbers"));
    }
  }
  if (errors.length) return { valid: false, errors };

  if (placement.x < 0 || placement.x > 100) {
    errors.push(fieldError("placement.x", "Signature position is outside the page horizontally"));
  }
  if (placement.y < 0 || placement.y > 100) {
    errors.push(fieldError("placement.y", "Signature position is outside the page vertically"));
  }
  if (placement.width < MIN_SIGNATURE_WIDTH_PCT || placement.width > MAX_SIGNATURE_WIDTH_PCT) {
    errors.push(
      fieldError(
        "placement.width",
        `Signature width must be between ${MIN_SIGNATURE_WIDTH_PCT}% and ${MAX_SIGNATURE_WIDTH_PCT}% of the page`,
      ),
    );
  }
  if (placement.height < MIN_SIGNATURE_HEIGHT_PCT || placement.height > MAX_SIGNATURE_HEIGHT_PCT) {
    errors.push(
      fieldError(
        "placement.height",
        `Signature height must be between ${MIN_SIGNATURE_HEIGHT_PCT}% and ${MAX_SIGNATURE_HEIGHT_PCT}% of the page`,
      ),
    );
  }
  // A signature may not hang off the page.
  if (placement.x + placement.width > 100) {
    errors.push(fieldError("placement.x", "Signature extends past the right edge of the page"));
  }
  if (placement.y + placement.height > 100) {
    errors.push(fieldError("placement.y", "Signature extends past the bottom edge of the page"));
  }

  return { valid: errors.length === 0, errors };
}

// ─── Workflow progression ─────────────────────────────────────────────────────

export interface StepDecisionInput {
  stepOrder: number;
  totalSteps: number;
  status: WorkflowStepStatusValue;
  decidedBy: number;
}

export type DecisionOutcome =
  | { kind: "ADVANCE"; nextStepOrder: number | null }
  | { kind: "FINALISE" }
  | { kind: "RETURN" }
  | { kind: "REJECT" };

/**
 * Decides what happens to the workflow once the active step has been decided.
 * Pure decision function so every caller behaves identically.
 */
export function decideWorkflowOutcome(
  action: ApprovalActionValue,
  step: StepDecisionInput,
): DecisionOutcome {
  if (action === "REJECT") return { kind: "REJECT" };
  if (action === "REQUEST_CHANGES") return { kind: "RETURN" };
  if (step.stepOrder >= step.totalSteps) return { kind: "FINALISE" };
  return { kind: "ADVANCE", nextStepOrder: step.stepOrder + 1 };
}

/** Document status a completed workflow leaves behind. */
export function statusAfterCompletion(cycle: DocumentStatusValue): DocumentStatusValue {
  return cycle === "SUBMITTED" ? "PENDING_APPROVAL" : cycle;
}

/** Progress label for the UI, e.g. "2 / 5 Approved". */
export function buildApprovalProgress(
  steps: { status: WorkflowStepStatusValue }[],
): { approved: number; total: number; label: string } {
  const total = steps.length;
  const approved = steps.filter((s) => s.status === "APPROVED").length;
  return { approved, total, label: `${approved} / ${total} Approved` };
}

/** Human label for the document number series, e.g. DOC-2026-00042. */
export function formatDocumentNumber(year: number, id: number): string {
  return `DOC-${year}-${String(id).padStart(5, "0")}`;
}

/** Due date for a step, derived from the configured SLA. */
export function computeStepDueAt(slaHours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + slaHours * 60 * 60 * 1000);
}

/** Guards a workflow step against a second decision (double-click, two tabs). */
export function assertStepDecidable(
  status: WorkflowStepStatusValue,
  decidedBy: number,
  actorUserId: number,
): { ok: true } | { ok: false; reason: string } {
  if (status !== "ACTIVE") {
    return {
      ok: false,
      reason: "This approval step is no longer active. It may already be completed by another action.",
    };
  }
  if (decidedBy !== actorUserId) {
    return {
      ok: false,
      reason: "You are not the assigned approver for this step.",
    };
  }
  return { ok: true };
}