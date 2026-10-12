import { prisma } from "./prisma";
import { transporter, isMailConfigured } from "./mailer";
import { logger } from "./logger";
import env from "../config/env";

/**
 * Workflow e-mails — "whosever turn comes in the serial gets mail".
 *
 * Generic across modules: document approvals mirror their in-app
 * `notifyUser` calls (submit → first approver, approve → next approver,
 * final/reject/changes → creator); manager reports use the same helper
 * (submit → approvers, approval → creator).
 *
 * Two hard rules:
 * - Mail is fire-and-forget. Call sites use `void sendApprovalMail(...)` so
 *   SMTP latency never slows the API response, and this function NEVER throws
 *   — a mail failure is logged, the workflow is unaffected.
 * - No SMTP credentials (`isMailConfigured()` false), inactive/deleted
 *   account, or missing email address means silent skip, same as the report
 *   mailer.
 */

export interface ApprovalMailInput {
  toUserId: number;
  subject: string;
  heading: string;
  intro: string;
  rows: Array<{ label: string; value: string }>;
  ctaLabel: string;
  ctaPath: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pure HTML renderer (exported for unit tests). All values are escaped. */
export function renderApprovalMailHtml(
  input: ApprovalMailInput & { recipientName: string; ctaHref: string },
): string {
  const rows = input.rows
    .map(
      (row) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;white-space:nowrap;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(row.value)}</td></tr>`,
    )
    .join("");
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">` +
    `<p style="font-size:14px;">Hello ${escapeHtml(input.recipientName)},</p>` +
    `<h2 style="font-size:18px;margin:8px 0;">${escapeHtml(input.heading)}</h2>` +
    `<p style="font-size:14px;color:#334155;">${escapeHtml(input.intro)}</p>` +
    `<table style="border-collapse:collapse;margin:12px 0;">${rows}</table>` +
    `<a href="${escapeHtml(input.ctaHref)}" style="display:inline-block;background:#0f766e;color:#ffffff;` +
    `text-decoration:none;font-size:14px;font-weight:bold;padding:10px 20px;border-radius:8px;">${escapeHtml(input.ctaLabel)}</a>` +
    `<p style="font-size:12px;color:#94a3b8;margin-top:16px;">X-Group · do not reply to this automated mail.</p>` +
    `</div>`
  );
}

export async function sendApprovalMail(input: ApprovalMailInput): Promise<void> {
  try {
    if (!isMailConfigured()) return;
    const user = await prisma.user.findUnique({
      where: { id: input.toUserId },
      select: { email: true, name: true, isActive: true, isDeleted: true },
    });
    if (!user || user.isDeleted || !user.isActive || !user.email) return;
    const base = env.app_url.replace(/\/$/, "");
    const html = renderApprovalMailHtml({
      ...input,
      recipientName: user.name,
      ctaHref: `${base}${input.ctaPath}`,
    });
    await transporter.sendMail({ from: env.email_sender, to: user.email, subject: input.subject, html });
  } catch (error) {
    logger.error(
      { err: error, toUserId: input.toUserId, subject: input.subject },
      "approval mail failed; workflow unaffected",
    );
  }
}
