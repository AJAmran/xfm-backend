/**
 * Non-destructive seed for the Document Approval & E-Signature module.
 *
 * Unlike `npm run seed` (which WIPES the database), this script is safe to run
 * against a live environment:
 *   - It never deletes existing rows.
 *   - It never touches feedback, branches, users or any other module.
 *   - Every write is an upsert, so repeated runs converge to the same state.
 *
 * Run it after `npm run db:deploy`:
 *   npm run seed:documents
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NotificationType, Role } from "../generated/prisma/enums";
import { DOCUMENT_TYPES, DEFAULT_DOCUMENT_POLICY_JSON } from "./document-catalog";
import { createSignatureImage } from "./png";
import { createSeedClient, runScript } from "./seed-utils";

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), "var", "storage");

/** Writes a real, openable PDF into local storage and returns its reference. */
async function writeSamplePdf(
  scope: string,
  title: string,
  body: string[],
): Promise<{ storageId: string; url: string; bytes: number; checksum: string; pageCount: number }> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([595.28, 841.89]);
  const margin = 48;
  let y = 841.89 - margin;

  page.drawText("X-Group Hospitality", { x: margin, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.45) });
  y -= 28;
  page.drawText(title, { x: margin, y, size: 17, font: bold, color: rgb(0.09, 0.1, 0.13), maxWidth: 595.28 - margin * 2 });
  y -= 26;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595.28 - margin, y },
    thickness: 0.6,
    color: rgb(0.85, 0.87, 0.9),
  });
  y -= 24;

  for (const line of body) {
    page.drawText(line, { x: margin, y, size: 10.5, font: regular, color: rgb(0.15, 0.16, 0.2), maxWidth: 595.28 - margin * 2 });
    y -= 16;
  }

  // A signature block so an approval placement has somewhere realistic to land.
  y -= 40;
  page.drawText("Approval", { x: margin, y, size: 10, font: bold, color: rgb(0.35, 0.37, 0.42) });
  y -= 46;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + 200, y },
    thickness: 0.8,
    color: rgb(0.55, 0.57, 0.62),
  });
  page.drawText("Signature", { x: margin, y: y - 12, size: 7.5, font: regular, color: rgb(0.5, 0.5, 0.55) });
  page.drawText("Date", { x: margin + 240, y: y - 12, size: 7.5, font: regular, color: rgb(0.5, 0.5, 0.55) });
  page.drawLine({
    start: { x: margin + 240, y },
    end: { x: margin + 380, y },
    thickness: 0.8,
    color: rgb(0.55, 0.57, 0.62),
  });

  const bytes = Buffer.from(await doc.save());
  const storageId = `${scope}/${randomUUID()}.pdf`;
  const absolute = path.join(LOCAL_STORAGE_ROOT, storageId);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);

  return {
    storageId,
    url: `/api/v1/documents/files/${storageId}`,
    bytes: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    pageCount: doc.getPageCount(),
  };
}

/** Renders a real PNG signature so seeded approvers can actually sign. */
async function writeSampleSignature(userId: number, seed: number): Promise<{ storageId: string; url: string }> {
  const bytes = createSignatureImage(seed);
  const storageId = `signatures/users/${userId}/${randomUUID()}.png`;
  const absolute = path.join(LOCAL_STORAGE_ROOT, storageId);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);

  return { storageId, url: `/api/v1/documents/files/${storageId}` };
}

runScript("🌱 Seeding document approval module (non-destructive)", async (prisma) => {
  // ─── Document types (upsert by unique code) ───────────────────────────────
  for (const type of DOCUMENT_TYPES) {
    await prisma.documentType.upsert({
      where: { code: type.code },
      create: {
        name: type.name,
        code: type.code,
        description: type.description,
        defaultSlaHours: type.defaultSlaHours,
        sortOrder: type.sortOrder,
      },
      // Never overwrite an admin's renames — only fill in missing metadata.
      update: { defaultSlaHours: type.defaultSlaHours, sortOrder: type.sortOrder },
    });
  }
  console.log(`  ✓ Document types: ${DOCUMENT_TYPES.length} present`);

  const typeByCode = new Map(
    (
      await prisma.documentType.findMany({ where: { isDeleted: false }, select: { id: true, code: true } })
    ).map((t) => [t.code, t.id]),
  );

  // ─── Default policy (only when absent) ───────────────────────────────────
  const existingPolicy = await prisma.systemSetting.findUnique({ where: { key: "document_policy" } });
  if (!existingPolicy) {
    await prisma.systemSetting.create({ data: { key: "document_policy", value: DEFAULT_DOCUMENT_POLICY_JSON } });
    console.log("  ✓ Policy: document_policy created with defaults");
  } else {
    console.log("  ✓ Policy: existing document_policy left untouched");
  }

  // ─── Signatures for internal approvers ────────────────────────────────────
  const approvers = await prisma.user.findMany({
    where: {
      isDeleted: false,
      isActive: true,
      role: { in: [Role.ADMIN, Role.COO, Role.MD, Role.BRANCH_MANAGER] },
    },
    select: { id: true, name: true, role: true, signatureAssetId: true },
    orderBy: { id: "asc" },
    take: 6,
  });

  for (const [index, approver] of approvers.entries()) {
    // Replace any legacy non-PNG sample asset so the UI can actually render it.
    const stale = approver.signatureAssetId?.endsWith(".pdf") ? approver.signatureAssetId : null;
    if (approver.signatureAssetId && !stale) continue;

    const signature = await writeSampleSignature(approver.id, approver.id * 7 + index);
    await prisma.user.update({
      where: { id: approver.id },
      data: { signatureAssetId: signature.storageId, signatureUrl: signature.url },
    });
    if (stale) {
      await fs.unlink(path.join(LOCAL_STORAGE_ROOT, stale)).catch(() => undefined);
    }
  }
  console.log(`  ✓ Signatures: ${approvers.length} approver(s) ready to sign`);

  // ─── Sample documents ─────────────────────────────────────────────────────
  /**
   * Titles this script creates. Used both to seed and to safely reset samples.
   * A reset only ever deletes rows matching these exact titles, and refuses to
   * run if any unrelated document is present.
   */
  const SAMPLE_TITLES = [
    "Purchase Request — Commercial Dishwasher (X-01)",
    "Purchase Request — Ceiling Fan Replacement (X-05)",
    "Leave Request — Annual Leave",
    "Policy Notice — Revised Staff Uniform Policy",
  ];

  const resetSamples = process.argv.includes("--reset-samples");

  if (resetSamples) {
    const all = await prisma.document.findMany({ where: { isDeleted: false }, select: { id: true, title: true } });
    const foreign = all.filter((d) => !SAMPLE_TITLES.includes(d.title));
    if (foreign.length) {
      throw new Error(
        `Refusing to reset: ${foreign.length} document(s) not created by this script exist ` +
          `(e.g. "${foreign[0]!.title}"). Delete the sample rows manually if you really want a reset.`,
      );
    }
    const ids = all.map((d) => d.id);
    if (ids.length) {
      // Audit rows cascade with the document, so this stays consistent.
      await prisma.document.deleteMany({ where: { id: { in: ids } } });
    }
    console.log(`  ✓ Reset: removed ${ids.length} previously seeded sample document(s)`);
  } else {
    const existingDocuments = await prisma.document.count({ where: { isDeleted: false } });
    if (existingDocuments > 0) {
      console.log(`  ✓ Documents: ${existingDocuments} already present — no samples created`);
      return;
    }
  }

  const author = await prisma.user.findFirst({
    where: { isDeleted: false, isActive: true, role: Role.BRANCH_MANAGER },
    select: { id: true, name: true, branchId: true },
  });
  if (!author) {
    console.log("  ⚠ No active branch manager found — skipping sample documents");
    return;
  }

  // A junior-to-senior chain, the shape the policy engine enforces.
  const byRole = async (role: Role, excludeIds: number[]) =>
    prisma.user.findFirst({
      where: { isDeleted: false, isActive: true, role, id: { notIn: excludeIds }, signatureAssetId: { not: null } },
      select: { id: true, name: true, role: true },
    });

  const used: number[] = [author.id];
  const chain = [] as { id: number; name: string; role: string }[];
  for (const role of [Role.BRANCH_MANAGER, Role.ADMIN, Role.COO, Role.MD] as Role[]) {
    const user = await byRole(role, used);
    if (!user) continue;
    used.push(user.id);
    chain.push({ id: user.id, name: user.name, role: user.role });
  }
  if (chain.length < 2) {
    console.log("  ⚠ Not enough signed approvers to build a sample chain — skipping");
    return;
  }

  interface SampleSpec {
    title: string;
    description: string;
    typeCode: string;
    status: "DRAFT" | "PENDING_APPROVAL" | "IN_REVIEW" | "RETURNED_FOR_REVISION";
    approvedSteps: number;
  }

  const samples: SampleSpec[] = [
    {
      title: SAMPLE_TITLES[0]!,
      description: "Requisition for two commercial-grade dishwashers for the Xian main kitchen.",
      typeCode: "PURCHASE_REQUEST",
      status: "DRAFT",
      approvedSteps: 0,
    },
    {
      title: SAMPLE_TITLES[1]!,
      description: "Replacement of ceiling fans in the Xindian main dining area.",
      typeCode: "PURCHASE_REQUEST",
      status: "IN_REVIEW",
      approvedSteps: 2,
    },
    {
      title: SAMPLE_TITLES[2]!,
      description: "Annual leave application for five consecutive days.",
      typeCode: "LEAVE_REQUEST",
      status: "RETURNED_FOR_REVISION",
      approvedSteps: 1,
    },
    {
      title: SAMPLE_TITLES[3]!,
      description: "Internal circular announcing the revised staff uniform policy effective next quarter.",
      typeCode: "POLICY_NOTICE",
      status: "PENDING_APPROVAL",
      approvedSteps: 0,
    },
  ];

  for (const sample of samples) {
    const typeId = typeByCode.get(sample.typeCode);
    if (!typeId) continue;

    const source = await writeSamplePdf(
      `documents/pending/${Date.now()}/v1`,
      sample.title,
      [
        `Document number: assigned on creation`,
        `Type: ${sample.typeCode}`,
        `Created by: ${author.name}`,
        "",
        sample.description,
        "",
        "This document was generated by the non-destructive document seed so the",
        "approval workflow can be exercised end to end without touching any",
        "existing operational data.",
      ],
    );

    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          documentNumber: `PENDING-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          title: sample.title,
          description: sample.description,
          documentTypeId: typeId,
          branchId: author.branchId,
          createdByUserId: author.id,
          status: "DRAFT",
          currentVersion: 1,
          submittedAt: null,
        },
        select: { id: true },
      });

      await tx.document.update({
        where: { id: document.id },
        data: { documentNumber: `DOC-${new Date().getFullYear()}-${String(document.id).padStart(5, "0")}` },
      });

      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          changeSummary: "Initial document",
          pageCount: source.pageCount,
          createdByUserId: author.id,
        },
        select: { id: true },
      });

      await tx.documentFile.create({
        data: {
          documentId: document.id,
          versionId: version.id,
          kind: "SOURCE",
          originalFileName: `${sample.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 120)}.pdf`,
          mimeType: "application/pdf",
          fileSize: source.bytes,
          storageProvider: "LOCAL_SECURE",
          storageId: source.storageId,
          resourceType: "raw",
          format: "pdf",
          checksum: source.checksum,
          pageCount: source.pageCount,
        },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId: document.id,
          documentVersion: 1,
          actorUserId: author.id,
          action: "DOCUMENT_CREATED",
          newStatus: "DRAFT",
        },
      });

      if (sample.status === "DRAFT") return { id: document.id };

      const now = Date.now();
      const steps = chain.map((approver, index) => {
        const order = index + 1;
        const isApproved = order <= sample.approvedSteps;
        const isActive = order === sample.approvedSteps + 1;
        return {
          stepOrder: order,
          approverUserId: approver.id,
          approverNameSnapshot: approver.name,
          approverRoleSnapshot: approver.role,
          status: (isApproved ? "APPROVED" : isActive ? "ACTIVE" : "PENDING") as "APPROVED" | "ACTIVE" | "PENDING",
          assignedAt: isApproved || isActive ? new Date(now - 24 * 3600_000) : null,
          dueAt: isApproved || isActive ? new Date(now + 24 * 3600_000) : null,
          completedAt: isApproved ? new Date(now - (24 - order) * 3600_000) : null,
        };
      });

      const instance = await tx.workflowInstance.create({
        data: {
          documentId: document.id,
          versionId: version.id,
          documentVersion: 1,
          status:
            sample.status === "IN_REVIEW"
              ? "IN_REVIEW"
              : sample.status === "RETURNED_FOR_REVISION"
                ? "RETURNED_FOR_REVISION"
                : "PENDING_APPROVAL",
          currentStepOrder: Math.min(sample.approvedSteps + 1, steps.length),
          totalSteps: steps.length,
          steps: { create: steps },
        },
        select: { id: true },
      });

      // Backfill approvals + signature snapshots for the completed steps.
      const approvedSteps = await tx.workflowStep.findMany({
        where: { workflowInstanceId: instance.id, status: "APPROVED" },
        orderBy: { stepOrder: "asc" },
        select: {
          id: true,
          stepOrder: true,
          approverUserId: true,
          approverNameSnapshot: true,
          approverRoleSnapshot: true,
          completedAt: true,
        },
      });

      for (const step of approvedSteps) {
        const approval = await tx.approval.create({
          data: {
            workflowStepId: step.id,
            documentId: document.id,
            approverUserId: step.approverUserId,
            action: "APPROVE_AND_SIGN",
            comments: "Approved as submitted.",
            createdAt: step.completedAt ?? new Date(),
          },
          select: { id: true },
        });

        const signer = approvers.find((a) => a.id === step.approverUserId);
        await tx.signaturePlacement.create({
          data: {
            workflowStepId: step.id,
            approvalId: approval.id,
            signerUserId: step.approverUserId,
            signerName: step.approverNameSnapshot,
            signerRoleSnapshot: step.approverRoleSnapshot,
            signatureStorageId: signer?.signatureAssetId ?? "",
            signatureProvider: "LOCAL_SECURE",
            signatureUrl: `signatures/users/${step.approverUserId}/sample`,
            signatureSha256: createHash("sha256")
              .update(`${step.id}:${step.approverUserId}`)
              .digest("hex"),
            pageNumber: 1,
            x: 9 + (step.stepOrder - 1) * 22,
            y: 84,
            width: 20,
            height: 5,
            signedAt: step.completedAt ?? new Date(),
          },
        });

        await tx.documentAuditLog.create({
          data: {
            documentId: document.id,
            documentVersion: 1,
            workflowStepId: step.id,
            actorUserId: step.approverUserId,
            action: "APPROVED_AND_SIGNED",
            previousStatus: step.stepOrder === 1 ? "PENDING_APPROVAL" : "IN_REVIEW",
            newStatus: "IN_REVIEW",
            createdAt: step.completedAt ?? new Date(),
          },
        });
      }

      if (sample.status === "RETURNED_FOR_REVISION") {
        const returned = await tx.workflowStep.findFirst({
          where: { workflowInstanceId: instance.id, stepOrder: sample.approvedSteps + 1 },
          select: { id: true, approverUserId: true },
        });
        if (returned) {
          const reason = "Please attach the revised quotation before this goes further.";
          await tx.workflowStep.update({
            where: { id: returned.id },
            data: { status: "RETURNED_FOR_REVISION", completedAt: new Date(now - 6 * 3600_000), reason },
          });
          await tx.approval.create({
            data: {
              workflowStepId: returned.id,
              documentId: document.id,
              approverUserId: returned.approverUserId,
              action: "REQUEST_CHANGES",
              comments: reason,
              createdAt: new Date(now - 6 * 3600_000),
            },
          });
          await tx.documentAuditLog.create({
            data: {
              documentId: document.id,
              documentVersion: 1,
              workflowStepId: returned.id,
              actorUserId: returned.approverUserId,
              action: "CHANGES_REQUESTED",
              previousStatus: "IN_REVIEW",
              newStatus: "RETURNED_FOR_REVISION",
              reason,
              createdAt: new Date(now - 6 * 3600_000),
            },
          });
          await tx.notification.create({
            data: {
              type: NotificationType.DOCUMENT_CHANGES_REQUESTED,
              title: "Changes requested",
              message: `"${sample.title}" was returned for revision.`,
              recipientUserId: author.id,
              actorUserId: returned.approverUserId,
              branchId: author.branchId,
              documentId: document.id,
              entityId: document.id,
            },
          });
        }
      }

      // The document's own status must always mirror the cycle it is in.
      await tx.document.update({
        where: { id: document.id },
        data: {
          status: sample.status,
          submittedAt: new Date(now - 36 * 3600_000),
        },
      });

      return { id: document.id };
    });

    console.log(`  ✓ Document: ${sample.title} (${sample.status}) → id ${created.id}`);
  }
});