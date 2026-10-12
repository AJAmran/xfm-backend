import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderApprovalMailHtml } from "./approval-mailer.js";

/**
 * Approval mail template â€” pure renderer, no SMTP involved.
 *
 * What matters here: every interpolated value is HTML-escaped (document
 * titles and reasons are user input), the CTA points at the frontend, and
 * the recipient sees their own name.
 */

const BASE = {
  toUserId: 189,
  subject: 'Action required: "Q3 Menu" needs your approval (X-Group Documents)',
  heading: "Your approval is needed",
  intro: "Abid submitted a document and you are approver 1 of 2.",
  rows: [
    { label: "Document", value: "Q3 Menu" },
    { label: "Number", value: "DOC-2026-001" },
  ],
  ctaLabel: "Open approvals inbox",
  ctaPath: "/dashboard/approvals",
};

describe("renderApprovalMailHtml", () => {
  it("renders heading, rows and a frontend CTA link", () => {
    const html = renderApprovalMailHtml({
      ...BASE,
      recipientName: "Zilhaj Pervez",
      ctaHref: "http://localhost:3000/dashboard/approvals",
    });
    assert.ok(html.includes("Hello Zilhaj Pervez,"));
    assert.ok(html.includes("Your approval is needed"));
    assert.ok(html.includes("Q3 Menu"));
    assert.ok(html.includes("DOC-2026-001"));
    assert.ok(html.includes("http://localhost:3000/dashboard/approvals"));
    assert.ok(html.includes("Open approvals inbox"));
  });

  it("escapes user-supplied titles, reasons and names", () => {
    const html = renderApprovalMailHtml({
      ...BASE,
      heading: 'Review <script>alert("x")</script>',
      intro: "Fish & chips",
      rows: [{ label: "Reason", value: 'Quote "this" & <that>' }],
      recipientName: "<b>Zilhaj</b>",
      ctaHref: "http://localhost:3000/dashboard/approvals",
    });
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("Fish &amp; chips"));
    assert.ok(html.includes("Quote &quot;this&quot; &amp; &lt;that&gt;"));
    assert.ok(html.includes("Hello &lt;b&gt;Zilhaj&lt;/b&gt;,"));
  });
});
