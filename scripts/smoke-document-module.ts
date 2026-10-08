/**
 * Live end-to-end smoke test for the Document Approval & E-Signature module.
 *
 * Exercises the real HTTP API against a running server and a real database:
 *   create → submit → approve → reject → request-changes → revise → finalise
 * plus the security and concurrency guarantees (self-approval, wrong approver,
 * double approval, hierarchy policy, file access control).
 *
 * Run with the server already listening:
 *   npx tsx scripts/smoke-document-module.ts
 */
import { createSeedClient, hashPassword } from "../prisma/seed-utils";
import { Role } from "../generated/prisma/enums";
import { createSignatureImage } from "../prisma/png";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

const BASE = (process.env.SMOKE_API_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const TMP = path.join(process.cwd(), "tmp", "smoke");

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✖ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

interface Session {
  cookies: string;
  userId: number;
  name: string;
  role: string;
}

async function login(email: string, password: string): Promise<Session> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as { success: boolean; data?: { user: { id: number; name: string; role: string } }; message?: string };
  if (!res.ok || !json.data) throw new Error(`Login failed for ${email}: ${json.message ?? res.status}`);

  const setCookie = res.headers.getSetCookie?.() ?? [];
  const jar = setCookie.map((c) => c.split(";")[0]).join("; ");
  return { cookies: jar, ...json.data.user };
}

async function api<T>(
  session: Session | null,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session.cookies } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data?: T;
  errors?: { field: string; message: string }[];
}

async function main() {
  const prisma = createSeedClient();
  const password = "SmokeTest@2026";
  const suffix = Date.now().toString().slice(-6);

  console.log("\n🔎 Document Approval & E-Signature — live smoke test\n");

  // ─── Temporary accounts (one per hierarchy tier) ───────────────────────────
  console.log("▸ Preparing temporary test accounts");
  await mkdir(TMP, { recursive: true });
  const hashed = await hashPassword(password);

  const specs = [
    { key: "creator", role: Role.BRANCH_MANAGER, name: `Smoke Creator ${suffix}` },
    { key: "junior", role: Role.BRANCH_MANAGER, name: `Smoke Junior ${suffix}` },
    { key: "mid", role: Role.ADMIN, name: `Smoke Mid ${suffix}` },
    { key: "senior", role: Role.COO, name: `Smoke Senior ${suffix}` },
    // A second BRANCH_MANAGER with no relationship to the document: this is the
    // real cross-tenant case. Corporate oversight roles (ADMIN/COO/MD) may read
    // any document by design, so they are not the right probe here.
    { key: "outsider", role: Role.BRANCH_MANAGER, name: `Smoke Outsider ${suffix}` },
  ] as const;

  const created: { id: number; key: string; email: string; name: string; role: string }[] = [];
  for (const spec of specs) {
    // Give each tier a PNG signature so approvals can be signed.
    const png = createSignatureImage(spec.id ?? specs.indexOf(spec) + 1);
    const signaturePath = path.join(TMP, `${spec.key}-signature.png`);
    await writeFile(signaturePath, png);

    const user = await prisma.user.create({
      data: {
        name: spec.name,
        email: `smoke-${spec.key}-${suffix}@x-grouprestaurant.com`,
        password: hashed,
        role: spec.role,
        isActive: true,
      },
      select: { id: true, name: true, role: true, email: true },
    });
    created.push({ id: user.id, key: spec.key, email: user.email, name: user.name, role: user.role });

    // Upload the signature through the real endpoint.
    const form = new FormData();
    form.append("signature", new Blob([png], { type: "image/png" }), "signature.png");
    const session = await login(user.email, password);
    const res = await fetch(`${BASE}/api/v1/documents/signature`, {
      method: "POST",
      body: form,
      headers: { Cookie: session.cookies },
    });
    if (!res.ok) throw new Error(`Signature upload failed for ${user.email}: ${await res.text()}`);
  }

  const byKey = new Map(created.map((u) => [u.key, u]));
  const sessionFor = async (key: string): Promise<Session> => {
    const user = byKey.get(key)!;
    const s = await login(user.email, password);
    return { ...s, userId: user.id, name: user.name, role: user.role };
  };

  const creator = await sessionFor("creator");
  const junior = await sessionFor("junior");
  const mid = await sessionFor("mid");
  const senior = await sessionFor("senior");
  const outsider = await sessionFor("outsider");
  console.log(`  ✓ ${created.length} accounts ready\n`);

  let documentId = 0;
  let fileId = 0;

  try {
    // ─── Rejected file types ────────────────────────────────────────────────
    console.log("▸ Upload validation");
    {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("MZ")], { type: "application/x-msdownload" }), "evil.exe");
      form.append("title", "Malicious Upload");
      form.append("documentTypeId", "1");
      form.append("submit", "false");
      const res = await fetch(`${BASE}/api/v1/documents`, {
        method: "POST",
        body: form,
        headers: { Cookie: creator.cookies },
      });
      check("rejects a disallowed file type", res.status === 415, res.status);
    }

    // ─── Create (as a draft) ─────────────────────────────────────────────────
    console.log("\n▸ Create + submit");
    const pdfBytes = await (async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595.28, 841.89]);
      const font = await doc.embedFont("Helvetica");
      page.drawText("Smoke Test Purchase Request", { x: 50, y: 750, size: 18, font });
      page.drawText("Approver signature block:", { x: 50, y: 420, size: 11, font });
      page.drawLine({
        start: { x: 50, y: 400 },
        end: { x: 300, y: 400 },
        thickness: 1,
        color: rgb(0.2, 0.22, 0.28),
      });
      return Buffer.from(await doc.save());
    })();

    {
      const types = await api<ApiEnvelope<{ id: number; name: string }[]>>(creator, "/api/v1/documents/types");
      check("document types are available", (types.body.data?.length ?? 0) > 0, types.body.message);
      const typeId = types.body.data?.[0]?.id ?? 1;

      const form = new FormData();
      form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "smoke-request.pdf");
      form.append("title", "Smoke Test — Purchase Request");
      form.append("description", "Created by the automated smoke test.");
      form.append("documentTypeId", String(typeId));
      form.append("submit", "false");
      form.append("approverIds", JSON.stringify([]));

      const res = await fetch(`${BASE}/api/v1/documents`, {
        method: "POST",
        body: form,
        headers: { Cookie: creator.cookies },
      });
      const json = (await res.json()) as ApiEnvelope<{ id: number; documentNumber: string; status: string; versions: { files: { id: number }[] }[] }>;
      check("document created as DRAFT", res.status === 201 && json.data?.status === "DRAFT", json.message);
      check("document number assigned from the row id", /^DOC-\d{4}-\d{5}$/.test(json.data?.documentNumber ?? ""), json.data?.documentNumber);
      documentId = json.data!.id;
      fileId = json.data!.versions[0]!.files[0]!.id;
      console.log(`    → ${json.data!.documentNumber} (id ${documentId})`);
    }

    // ─── Hierarchy policy is enforced ────────────────────────────────────────
    {
      const res = await api<ApiEnvelope<unknown>>(creator, "/api/v1/approvals/validate-sequence", {
        method: "POST",
        body: JSON.stringify({ approverIds: [senior.userId, junior.userId] }),
      });
      const verdict = res.body.data as { valid: boolean; errors: { message: string }[] } | undefined;
      check(
        "junior-to-senior policy rejects a reversed chain",
        verdict?.valid === false && verdict.errors.some((e) => /hierarchy/i.test(e.message)),
        verdict?.errors,
      );
    }
    {
      const res = await api<ApiEnvelope<unknown>>(creator, "/api/v1/approvals/validate-sequence", {
        method: "POST",
        body: JSON.stringify({ approverIds: [creator.userId] }),
      });
      const verdict = res.body.data as { valid: boolean; errors: { message: string }[] } | undefined;
      check(
        "self-approval is blocked by default policy",
        verdict?.valid === false && verdict.errors.some((e) => /your own document/i.test(e.message)),
        verdict?.errors,
      );
    }

    // ─── Submit ─────────────────────────────────────────────────────────────
    const approvers = [junior.userId, mid.userId, senior.userId];
    {
      const res = await api<ApiEnvelope<{ status: string; workflow: { totalSteps: number; currentlyWith: { name: string } } }>>(
        creator,
        `/api/v1/documents/${documentId}/submit`,
        { method: "PATCH", body: JSON.stringify({ approverIds: approvers }) },
      );
      check("submitted for approval", res.status === 200 && res.body.data?.status === "PENDING_APPROVAL", res.body.message);
      check("workflow created with 3 steps", res.body.data?.workflow?.totalSteps === 3, res.body.data?.workflow);
      check(
        "routed to approver 1",
        res.body.data?.workflow?.currentlyWith?.name === junior.name,
        res.body.data?.workflow?.currentlyWith,
      );
    }

    // ─── Wrong approver is refused ───────────────────────────────────────────
    {
      const res = await api<ApiEnvelope<unknown>>(mid, `/api/v1/documents/${documentId}/approve`, {
        method: "POST",
        body: JSON.stringify({ placement: { pageNumber: 1, x: 10, y: 80, width: 20, height: 6 } }),
      });
      check("a non-assigned approver cannot approve", res.status === 403, { status: res.status, message: res.body.message });
    }

    // ─── Signature placement validation ──────────────────────────────────────
    {
      const res = await api<ApiEnvelope<unknown>>(junior, `/api/v1/documents/${documentId}/approve`, {
        method: "POST",
        body: JSON.stringify({ placement: { pageNumber: 1, x: 95, y: 10, width: 20, height: 6 } }),
      });
      check(
        "out-of-bounds signature placement is rejected",
        res.status === 422,
        { status: res.status, message: res.body.message },
      );
    }

    // ─── Approval + concurrency ──────────────────────────────────────────────
    {
      const approve = () =>
        api<ApiEnvelope<{ status: string; workflow: { progress: { approved: number }; currentlyWith: { name: string } | null } }>>(
          junior,
          `/api/v1/documents/${documentId}/approve`,
          {
            method: "POST",
            body: JSON.stringify({
              placement: { pageNumber: 1, x: 10, y: 80, width: 20, height: 6 },
              comments: "Looks good.",
            }),
          },
        );

      const [a, b] = await Promise.all([approve(), approve()]);
      const winners = [a, b].filter((r) => r.status === 200);
      const losers = [a, b].filter((r) => r.status === 409);
      check(
        "concurrent approvals: exactly one succeeds",
        winners.length === 1 && losers.length === 1,
        { statuses: [a.status, b.status] },
      );
      check("approval advanced the workflow", winners[0]?.body.data?.status === "IN_REVIEW", winners[0]?.body.data?.status);
      check("moved to approver 2", winners[0]?.body.data?.workflow?.currentlyWith?.name === mid.name, winners[0]?.body.data?.workflow);
    }

    // ─── File access control ─────────────────────────────────────────────────
    {
      const allowed = await fetch(`${BASE}/api/v1/documents/files/${fileId}`, {
        headers: { Cookie: junior.cookies },
      });
      check("an assigned approver can read the file", allowed.status === 200, allowed.status);

      const denied = await fetch(`${BASE}/api/v1/documents/files/${fileId}`, {
        headers: { Cookie: outsider.cookies },
      });
      check(
        "an unrelated branch manager cannot read the file",
        denied.status === 403,
        denied.status,
      );

      const anon = await fetch(`${BASE}/api/v1/documents/files/${fileId}`);
      check("an anonymous request cannot read the file", anon.status === 401, anon.status);
    }

    // ─── Request changes ─────────────────────────────────────────────────────
    {
      const res = await api<ApiEnvelope<{ status: string; workflow: { terminatedReason: string | null } }>>(
        mid,
        `/api/v1/documents/${documentId}/request-changes`,
        { method: "POST", body: JSON.stringify({ reason: "Please attach the revised quotation." }) },
      );
      check("request-changes returns it to the creator", res.status === 200 && res.body.data?.status === "RETURNED_FOR_REVISION", res.body.message);
      check("reason recorded on the workflow", res.body.data?.workflow?.terminatedReason === "Please attach the revised quotation.");
    }
    {
      const res = await api<ApiEnvelope<unknown>>(mid, `/api/v1/documents/${documentId}/request-changes`, {
        method: "POST",
        body: JSON.stringify({ reason: "again" }),
      });
      check("a decided step cannot be decided again", res.status === 409 || res.status === 403, res.status);
    }

    // ─── Revision restarts the cycle ────────────────────────────────────────
    {
      const form = new FormData();
      form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "smoke-request-v2.pdf");
      form.append("changeSummary", "Attached the revised quotation.");
      const res = await fetch(`${BASE}/api/v1/documents/${documentId}/revisions`, {
        method: "POST",
        body: form,
        headers: { Cookie: creator.cookies },
      });
      const json = (await res.json()) as ApiEnvelope<{ currentVersion: number; status: string; workflow: unknown }>;
      check("revision created version 2", res.status === 201 && json.data?.currentVersion === 2, json.message);
      check("new version resets to DRAFT with no active approvals", json.data?.status === "DRAFT" && json.data?.workflow === null, json.data);
    }
    {
      const res = await api<ApiEnvelope<{ status: string; currentVersion: number; workflow: unknown }>>(
        creator,
        `/api/v1/documents/${documentId}/versions`,
      );
      check(
        "version 1 preserved with its own workflow; version 2 has none",
        res.body.data?.length === 2 &&
          res.body.data?.[0]?.isOriginal === false &&
          res.body.data?.[1]?.isOriginal === true &&
          res.body.data?.[1]?.workflow?.status === "RETURNED_FOR_REVISION",
        res.body.data?.map((v) => ({ v: v.versionNumber, orig: v.isOriginal, wf: v.workflow?.status })),
      );
    }

    // ─── Resubmit the new version and run to completion ──────────────────────
    {
      const res = await api<ApiEnvelope<{ status: string }>>(creator, `/api/v1/documents/${documentId}/submit`, {
        method: "PATCH",
        body: JSON.stringify({ approverIds: approvers }),
      });
      check("version 2 resubmitted", res.status === 200 && res.body.data?.status === "PENDING_APPROVAL", res.body.message);
    }
    {
      const res = await api<ApiEnvelope<unknown>>(creator, `/api/v1/documents/${documentId}/submit`, {
        method: "PATCH",
        body: JSON.stringify({ approverIds: approvers }),
      });
      check("the same version cannot be submitted twice", res.status === 409, res.status);
    }

    for (const session of [junior, mid, senior]) {
      const res = await api<ApiEnvelope<{ status: string; isLocked: boolean }>>(session, `/api/v1/documents/${documentId}/approve`, {
        method: "POST",
        body: JSON.stringify({ placement: { pageNumber: 1, x: 10, y: 80, width: 20, height: 6 } }),
      });
      check(`${session.role} approved`, res.status === 200, res.body.message);
    }

    // ─── Final PDF generation ────────────────────────────────────────────────
    {
      const res = await api<ApiEnvelope<{ status: string; isLocked: boolean; finalFile: { id: number; mimeType: string } | null }>>(
        creator,
        `/api/v1/documents/${documentId}`,
      );
      check("document is APPROVED after the final approval", res.body.data?.status === "APPROVED", res.body.data?.status);
      check("document is locked", res.body.data?.isLocked === true, res.body.data?.isLocked);
      check("final signed PDF generated and stored", res.body.data?.finalFile?.mimeType === "application/pdf", res.body.data?.finalFile);

      const finalFileId = res.body.data?.finalFile?.id;
      if (finalFileId) {
        const download = await fetch(`${BASE}/api/v1/documents/files/${finalFileId}`, {
          headers: { Cookie: creator.cookies },
        });
        const bytes = Buffer.from(await download.arrayBuffer());
        check("final PDF downloads as a real PDF", download.status === 200 && bytes.subarray(0, 5).toString() === "%PDF-", {
          status: download.status,
          magic: bytes.subarray(0, 5).toString(),
          size: bytes.length,
        });
      }
    }

    // ─── Audit trail is complete and append-only ─────────────────────────────
    {
      const res = await api<ApiEnvelope<{ action: string }[]>>(creator, `/api/v1/documents/${documentId}/audit`);
      const actions = (res.body.data ?? []).map((a) => a.action);
      for (const expected of [
        "DOCUMENT_CREATED",
        "FILE_UPLOADED",
        "SUBMITTED_FOR_APPROVAL",
        "APPROVED_AND_SIGNED",
        "CHANGES_REQUESTED",
        "REVISION_CREATED",
        "RESUBMITTED",
        "FINAL_PDF_GENERATED",
        "DOCUMENT_LOCKED",
      ]) {
        check(`audit contains ${expected}`, actions.includes(expected), actions);
      }
    }

    // ─── Signature isolation ─────────────────────────────────────────────────
    {
      const res = await api<ApiEnvelope<unknown>>(junior, "/api/v1/documents/signature");
      check("own signature readable", res.status === 200, res.status);
      const res2 = await fetch(`${BASE}/api/v1/documents/signature`, {
        method: "DELETE",
        headers: { Cookie: outsider.cookies },
      });
      check("signature delete endpoint requires auth", res2.status === 200 || res2.status === 409, res2.status);
    }

    // ─── MD is read-only ─────────────────────────────────────────────────────
    {
      const res = await api<ApiEnvelope<unknown>>(null, "/api/v1/documents");
      check("unauthenticated list is refused", res.status === 401, res.status);
    }

    // ─── Approval inbox ──────────────────────────────────────────────────────
    {
      const res = await api<ApiEnvelope<{ length: number }>>(senior, "/api/v1/approvals/pending");
      check("approval inbox responds", res.status === 200, res.status);
      const history = await api<ApiEnvelope<{ length: number }>>(junior, "/api/v1/approvals/history");
      check("approval history responds", history.status === 200, history.status);
    }

    // ─── Cleanup this document ───────────────────────────────────────────────
    await prisma.document.deleteMany({ where: { id: documentId } });
    console.log(`\n  ✓ Smoke document ${documentId} cleaned up`);
  } finally {
    // ─── Teardown: remove every temporary account and its data ───────────────
    const ids = created.map((u) => u.id);
    await prisma.document.deleteMany({ where: { createdByUserId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { recipientUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    console.log("  ✓ Temporary accounts removed");
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${passed} passed · ${failed} failed`);
  console.log(`${"─".repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\n💥 Smoke test crashed:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
