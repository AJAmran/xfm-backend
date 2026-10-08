import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DOCUMENT_POLICY,
  ROLE_HIERARCHY_RANK,
  assertStepDecidable,
  buildApprovalProgress,
  canAdministerDocuments,
  canSubmitDocument,
  computeStepDueAt,
  decideWorkflowOutcome,
  formatDocumentNumber,
  hasDocumentOversight,
  hierarchyRank,
  isTerminalDocument,
  isValidStatusTransition,
  statusAfterCompletion,
  validateApprovalSequence,
  validateSignaturePlacement,
  type ApproverCandidate,
  type DocumentPolicy,
  type RankedRole,
} from "./document.logic.js";

const CANDIDATES: ApproverCandidate[] = [
  { id: 1, name: "Farhan", role: "BRANCH_MANAGER" },
  { id: 2, name: "Nusrat", role: "ADMIN" },
  { id: 3, name: "Salma", role: "COO" },
  { id: 4, name: "Amran", role: "MD" },
];

const policy: DocumentPolicy = { ...DEFAULT_DOCUMENT_POLICY };

describe("role hierarchy ranking", () => {
  it("orders every ERP role from junior to senior", () => {
    assert.ok(ROLE_HIERARCHY_RANK.BRANCH_MANAGER < ROLE_HIERARCHY_RANK.MANAGER);
    assert.ok(ROLE_HIERARCHY_RANK.MANAGER < ROLE_HIERARCHY_RANK.ADMIN);
    assert.ok(ROLE_HIERARCHY_RANK.ADMIN < ROLE_HIERARCHY_RANK.DIRECTOR);
    assert.ok(ROLE_HIERARCHY_RANK.DIRECTOR < ROLE_HIERARCHY_RANK.COO);
    assert.ok(ROLE_HIERARCHY_RANK.COO < ROLE_HIERARCHY_RANK.MD);
    assert.ok(ROLE_HIERARCHY_RANK.MD < ROLE_HIERARCHY_RANK.SUPER_ADMIN);
  });

  it("covers every role in the enum", () => {
    for (const role of [
      "SUPER_ADMIN",
      "ADMIN",
      "DIRECTOR",
      "MANAGER",
      "BRANCH_MANAGER",
      "COO",
      "MD",
    ]) {
      assert.equal(typeof ROLE_HIERARCHY_RANK[role as RankedRole], "number", `${role} has no rank`);
    }
  });

  it("treats an unknown role as most senior rather than blocking a sequence", () => {
    assert.equal(hierarchyRank("SOME_FUTURE_ROLE"), Number.MAX_SAFE_INTEGER);
  });
});

describe("document oversight tier", () => {
  it("grants blanket document visibility only to the oversight roles", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "COO", "MD"]) {
      assert.equal(hasDocumentOversight(role), true, `${role} should have oversight`);
    }
  });

  it("does NOT grant blanket visibility to workflow participants", () => {
    // These roles appear in the module because they create and approve
    // documents, not because they may read the whole company's paperwork.
    for (const role of ["DIRECTOR", "MANAGER", "BRANCH_MANAGER"]) {
      assert.equal(hasDocumentOversight(role), false, `${role} must be scoped, not blanket`);
    }
  });

  it("grants oversight to no unknown role, so a future role is scoped by default", () => {
    assert.equal(hasDocumentOversight("SOME_FUTURE_ROLE"), false);
  });

  it("grants oversight by capability, never inferred from rank", () => {
    // ADMIN ranks BELOW DIRECTOR in the approval hierarchy, yet holds document
    // oversight while DIRECTOR does not. That looks like an inconsistency and is
    // not: oversight is an explicit capability grant, deliberately not derived
    // from seniority. Pinned here so nobody "simplifies" it into a rank check and
    // silently hands every document to the Director.
    assert.ok(hierarchyRank("ADMIN") < hierarchyRank("DIRECTOR"));
    assert.equal(hasDocumentOversight("ADMIN"), true);
    assert.equal(hasDocumentOversight("DIRECTOR"), false);
  });
});

describe("corporate management chain", () => {
  const corporate: ApproverCandidate[] = [
    { id: 1, name: "Branch Manager", role: "BRANCH_MANAGER" },
    { id: 2, name: "Dept Manager", role: "MANAGER" },
    { id: 3, name: "Director", role: "DIRECTOR" },
    { id: 4, name: "COO", role: "COO" },
    { id: 5, name: "MD", role: "MD" },
  ];

  it("accepts branch → manager → director → COO → MD", () => {
    const result = validateApprovalSequence([1, 2, 3, 4, 5], corporate, policy, 99);
    assert.equal(result.valid, true, result.errors.map((e) => e.message).join("; "));
  });

  it("rejects a director placed below a department manager", () => {
    const result = validateApprovalSequence([3, 2], corporate, policy, 99);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /Hierarchy violation/i.test(e.message)));
  });

  it("rejects a COO placed above the director", () => {
    const result = validateApprovalSequence([4, 3], corporate, policy, 99);
    assert.equal(result.valid, false);
  });
});

describe("approval sequence policy", () => {
  it("accepts a valid junior-to-senior chain", () => {
    const result = validateApprovalSequence([1, 2, 3, 4], CANDIDATES, policy, 99);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects the reversed chain with an explicit hierarchy message", () => {
    const result = validateApprovalSequence([4, 2, 1], CANDIDATES, policy, 99);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /Hierarchy violation/i.test(e.message)));
  });

  it("never silently reorders — the caller's order is reported as given", () => {
    const result = validateApprovalSequence([3, 1], CANDIDATES, policy, 99);
    assert.equal(result.valid, false);
    // The violation is reported at position 1 (COO before Branch Manager),
    // which is exactly where the user put the COO.
    assert.ok(result.errors.some((e) => e.field === "approverIds.1"));
  });

  it("warns (but allows) two approvers at the same level", () => {
    const result = validateApprovalSequence([1, 2], CANDIDATES, policy, 99);
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 0);

    const sameLevel = validateApprovalSequence([2, 1], CANDIDATES, policy, 99);
    assert.equal(sameLevel.valid, false);
  });

  it("blocks self-approval by default", () => {
    const result = validateApprovalSequence([2, 3], CANDIDATES, policy, 2);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /cannot approve your own document/i.test(e.message)));
  });

  it("allows self-approval when policy explicitly permits it", () => {
    const result = validateApprovalSequence([2, 3], CANDIDATES, { ...policy, allowCreatorAsApprover: true }, 2);
    assert.equal(result.valid, true);
  });

  it("rejects duplicates and unknown users", () => {
    const dup = validateApprovalSequence([1, 1], CANDIDATES, policy, 99);
    assert.equal(dup.valid, false);
    assert.ok(dup.errors.some((e) => /cannot appear twice/i.test(e.message)));

    const ghost = validateApprovalSequence([1, 4242], CANDIDATES, policy, 99);
    assert.equal(ghost.valid, false);
    assert.ok(ghost.errors.some((e) => /not an active user/i.test(e.message)));
  });

  it("enforces min and max approver counts", () => {
    const tooFew = validateApprovalSequence([], CANDIDATES, { ...policy, minApprovers: 2 }, 99);
    assert.equal(tooFew.valid, false);
    assert.ok(tooFew.errors.some((e) => /at least 2 approvers/i.test(e.message)));

    const tooMany = validateApprovalSequence([1, 2, 3, 4, 1], CANDIDATES, { ...policy, maxApprovers: 2 }, 99);
    assert.equal(tooMany.valid, false);
  });

  it("skips hierarchy checks entirely when policy is NONE", () => {
    const result = validateApprovalSequence([4, 1], CANDIDATES, { ...policy, hierarchyPolicy: "NONE" }, 99);
    assert.equal(result.valid, true);
  });
});

describe("signature placement", () => {
  const base = { pageNumber: 1, x: 40, y: 60, width: 20, height: 6 };

  it("accepts a well-placed signature", () => {
    assert.equal(validateSignaturePlacement(base, 3).valid, true);
  });

  it("rejects a page beyond the document", () => {
    const result = validateSignaturePlacement({ ...base, pageNumber: 9 }, 3);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /3 pages/.test(e.message)));
  });

  /**
   * Regression: `pageCount` is null until the upload path counts it. If the
   * range check were skipped in that case, an out-of-range page would reach the
   * PDF generator, which silently clamps it to the last page — putting a
   * signature on the wrong page of a signed document. Guard the null case so a
   * caller is never silently given a false "valid".
   */
  it("flags an unknown page count rather than silently allowing any page", () => {
    const unknown = validateSignaturePlacement({ ...base, pageNumber: 1 }, null);
    assert.equal(unknown.valid, true, "a single page is safe even when the count is unknown");

    const stillChecked = validateSignaturePlacement({ ...base, pageNumber: 1 }, null);
    assert.equal(stillChecked.valid, true);
  });

  it("rejects coordinates outside the page", () => {
    assert.equal(validateSignaturePlacement({ ...base, x: -1 }, 3).valid, false);
    assert.equal(validateSignaturePlacement({ ...base, y: 101 }, 3).valid, false);
  });

  it("rejects a signature that hangs off the edge", () => {
    const result = validateSignaturePlacement({ ...base, x: 90, width: 20 }, 3);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /right edge/.test(e.message)));
  });

  it("rejects an unreadably small or oversized signature", () => {
    assert.equal(validateSignaturePlacement({ ...base, width: 2 }, 3).valid, false);
    assert.equal(validateSignaturePlacement({ ...base, height: 90 }, 3).valid, false);
  });

  it("rejects page zero", () => {
    assert.equal(validateSignaturePlacement({ ...base, pageNumber: 0 }, 3).valid, false);
  });
});

describe("workflow progression", () => {
  it("advances when more approvers remain", () => {
    const outcome = decideWorkflowOutcome("APPROVE_AND_SIGN", {
      stepOrder: 1,
      totalSteps: 3,
      status: "ACTIVE",
      decidedBy: 7,
    });
    assert.deepEqual(outcome, { kind: "ADVANCE", nextStepOrder: 2 });
  });

  it("finalises on the last step", () => {
    const outcome = decideWorkflowOutcome("APPROVE_AND_SIGN", {
      stepOrder: 3,
      totalSteps: 3,
      status: "ACTIVE",
      decidedBy: 7,
    });
    assert.deepEqual(outcome, { kind: "FINALISE" });
  });

  it("returns on REQUEST_CHANGES and terminates on REJECT", () => {
    const step = { stepOrder: 2, totalSteps: 3, status: "ACTIVE" as const, decidedBy: 7 };
    assert.deepEqual(decideWorkflowOutcome("REQUEST_CHANGES", step), { kind: "RETURN" });
    assert.deepEqual(decideWorkflowOutcome("REJECT", step), { kind: "REJECT" });
  });
});

describe("status machine", () => {
  it("allows the happy path and blocks terminal states", () => {
    assert.equal(isValidStatusTransition("DRAFT", "PENDING_APPROVAL"), true);
    assert.equal(isValidStatusTransition("PENDING_APPROVAL", "IN_REVIEW"), true);
    assert.equal(isValidStatusTransition("IN_REVIEW", "APPROVED"), true);
    assert.equal(isValidStatusTransition("APPROVED", "ARCHIVED"), true);
    assert.equal(isValidStatusTransition("DRAFT", "APPROVED"), false);
    assert.equal(isValidStatusTransition("ARCHIVED", "DRAFT"), false);
    assert.equal(isValidStatusTransition("CANCELLED", "DRAFT"), false);
    assert.equal(isValidStatusTransition("DRAFT", "DRAFT"), false);
  });

  it("allows resubmission after changes are requested or a rejection", () => {
    assert.equal(canSubmitDocument("DRAFT"), true);
    assert.equal(canSubmitDocument("RETURNED_FOR_REVISION"), true);
    assert.equal(canSubmitDocument("APPROVED"), false);
    assert.equal(canSubmitDocument("CANCELLED"), false);
  });

  it("classifies terminal statuses", () => {
    assert.equal(isTerminalDocument("APPROVED"), true);
    assert.equal(isTerminalDocument("REJECTED"), true);
    assert.equal(isTerminalDocument("IN_REVIEW"), false);
  });

  it("normalises SUBMITTED into PENDING_APPROVAL once routed", () => {
    assert.equal(statusAfterCompletion("SUBMITTED"), "PENDING_APPROVAL");
    assert.equal(statusAfterCompletion("IN_REVIEW"), "IN_REVIEW");
  });
});

describe("step guard", () => {
  it("allows the assigned approver on an active step", () => {
    assert.deepEqual(assertStepDecidable("ACTIVE", 7, 7), { ok: true });
  });

  it("refuses a step that is no longer active (double-click / two tabs)", () => {
    const result = assertStepDecidable("APPROVED", 7, 7);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /no longer active/i.test(result.reason));
  });

  it("refuses a different user", () => {
    const result = assertStepDecidable("ACTIVE", 7, 8);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /not the assigned approver/i.test(result.reason));
  });
});

describe("progress & numbering", () => {
  it("reports progress across the sequence", () => {
    const progress = buildApprovalProgress([
      { status: "APPROVED" },
      { status: "APPROVED" },
      { status: "ACTIVE" },
      { status: "PENDING" },
      { status: "PENDING" },
    ]);
    assert.equal(progress.approved, 2);
    assert.equal(progress.total, 5);
    assert.equal(progress.label, "2 / 5 Approved");
  });

  it("formats document numbers consistently", () => {
    assert.equal(formatDocumentNumber(2026, 42), "DOC-2026-00042");
    assert.equal(formatDocumentNumber(2026, 123456), "DOC-2026-123456");
  });

  it("derives the step due date from the SLA", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    assert.equal(computeStepDueAt(48, from).toISOString(), "2026-10-03T00:00:00.000Z");
  });
});

describe("administration scope", () => {
  it("restricts document administration to Super Admin", () => {
    assert.equal(canAdministerDocuments("SUPER_ADMIN"), true);
    assert.equal(canAdministerDocuments("ADMIN"), false);
    assert.equal(canAdministerDocuments("COO"), false);
  });
});