/**
 * Document types for the Document Approval & E-Signature module.
 *
 * `defaultSlaHours` drives the due date of each workflow step and the reminder /
 * escalation thresholds, so it should reflect how quickly the company expects a
 * given class of document to move.
 *
 * Approval hierarchy is derived from the ERP's existing roles
 * (see src/modules/document/document.logic.ts → ROLE_HIERARCHY_RANK):
 *   BRANCH_MANAGER (10) < ADMIN (20) < COO (30) < MD (40) < SUPER_ADMIN (50)
 */
export interface DocumentTypeSeed {
  code: string;
  name: string;
  description: string;
  defaultSlaHours: number;
  sortOrder: number;
}

export const DOCUMENT_TYPES: DocumentTypeSeed[] = [
  {
    code: "PURCHASE_REQUEST",
    name: "Purchase Request",
    description: "Requisition for goods, equipment or services requiring management approval.",
    defaultSlaHours: 48,
    sortOrder: 1,
  },
  {
    code: "LEAVE_REQUEST",
    name: "Leave Request",
    description: "Staff leave application routed to the reporting manager and HR.",
    defaultSlaHours: 24,
    sortOrder: 2,
  },
  {
    code: "EXPENSE_CLAIM",
    name: "Expense Claim",
    description: "Reimbursement claim for expenses incurred on behalf of the group.",
    defaultSlaHours: 72,
    sortOrder: 3,
  },
  {
    code: "SALARY_REVISION",
    name: "Salary Revision",
    description: "Annual or mid-year salary adjustment proposal.",
    defaultSlaHours: 120,
    sortOrder: 4,
  },
  {
    code: "CONTRACT",
    name: "Contract",
    description: "Vendor, supplier or employment agreement for final sign-off.",
    defaultSlaHours: 168,
    sortOrder: 5,
  },
  {
    code: "POLICY_NOTICE",
    name: "Policy Notice",
    description: "Internal circular, memo or policy communication.",
    defaultSlaHours: 48,
    sortOrder: 6,
  },
  {
    code: "HR_DOCUMENT",
    name: "HR Document",
    description: "Appointment letter, increment letter, disciplinary note or HR record.",
    defaultSlaHours: 96,
    sortOrder: 7,
  },
  {
    code: "PROCUREMENT",
    name: "Procurement Tender",
    description: "Tender evaluation or procurement committee recommendation.",
    defaultSlaHours: 120,
    sortOrder: 8,
  },
];

/**
 * Default module policy written to `system_settings.document_policy`.
 * Mirrors DEFAULT_DOCUMENT_POLICY in the backend so a fresh database and a
 * fresh code checkout agree.
 */
export const DEFAULT_DOCUMENT_POLICY_JSON = JSON.stringify({
  hierarchyPolicy: "JUNIOR_TO_SENIOR",
  minApprovers: 1,
  maxApprovers: 10,
  allowCreatorAsApprover: false,
  reminderAfterHours: 24,
  escalateAfterHours: 48,
  maxApprovalDays: 7,
  requireSignature: true,
});