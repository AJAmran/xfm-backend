import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { storeBuffer, activeProvider } from "../../lib/storage.service";
import { recordAudit } from "./document-audit.service";
import { logger } from "../../lib/logger";

/**
 * The signed-in user's own saved signature.
 *
 * Security rules enforced here:
 *   - A user can only ever read or replace THEIR OWN signature. The target id
 *     is compared against the authenticated session, never trusted from input.
 *   - An approval never accepts a signature id from the client; the service
 *     resolves the signer's asset from the database.
 *   - Replacing a signature does NOT alter historical approvals. Every approval
 *     stores its own immutable `SignaturePlacement` copy.
 */

export async function getOwnSignature(userId: number) {
  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      signatureAssetId: true,
      signatureProvider: true,
      signatureUrl: true,
    },
  });
  if (!user) throw appError("User not found", httpStatus.NOT_FOUND);

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    signatureUrl: user.signatureUrl,
    hasSignature: Boolean(user.signatureAssetId && user.signatureUrl),
  };
}

/**
 * Stores a new signature image and links it to the account.
 *
 * The previous asset is deliberately NOT deleted: `SignaturePlacement` rows
 * reference it, so removing it would destroy the evidence behind historical
 * approvals (and break final-PDF generation for in-flight workflows). Orphaned
 * signature assets are cleaned up by a storage-retention job, never here.
 */
export async function replaceOwnSignature(userId: number, upload: Express.Multer.File) {
  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: { id: true, name: true, signatureAssetId: true, signatureUrl: true },
  });
  if (!user) throw appError("User not found", httpStatus.NOT_FOUND);

  const stored = await storeBuffer(
    upload.buffer,
    `signatures/users/${user.id}`,
    upload.originalname,
    upload.mimetype,
    "image",
  );

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      signatureAssetId: stored.storageId,
      // Remember which store holds the bytes. Reading the signature back must
      // never depend on what the deployment is configured for today.
      signatureProvider: stored.provider,
      // Keep the legacy display column in sync so existing approval stamps and
      // the user-management screen keep working.
      signatureUrl: stored.url,
    },
    select: { signatureAssetId: true, signatureUrl: true },
  });

  logger.info(
    { userId, previousAssetId: user.signatureAssetId, newAssetId: stored.storageId, provider: stored.provider },
    "user signature replaced; previous asset retained for historical approvals",
  );

  return {
    userId,
    signatureUrl: updated.signatureUrl,
    hasSignature: true,
    provider: stored.provider,
    bytes: stored.bytes,
  };
}

/**
 * Removes the saved signature.
 *
 * Blocked while the user holds an active approval step, because an approval can
 * only be signed with a saved signature — clearing it mid-flight would strand
 * the document.
 */
export async function clearOwnSignature(userId: number) {
  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: { id: true, signatureAssetId: true },
  });
  if (!user) throw appError("User not found", httpStatus.NOT_FOUND);

  const activeStep = await prisma.workflowStep.findFirst({
    where: { approverUserId: userId, status: "ACTIVE" },
    select: { id: true, workflowInstance: { select: { documentId: true, documentVersion: true } } },
  });
  if (activeStep) {
    throw appError(
      `You cannot remove your signature while you hold an active approval step on document ${activeStep.workflowInstance.documentId} (version ${activeStep.workflowInstance.documentVersion})`,
      httpStatus.CONFLICT,
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { signatureAssetId: null, signatureProvider: null, signatureUrl: null },
  });

  // The asset itself is retained: historical `SignaturePlacement` rows still
  // reference it and must keep rendering exactly as they were signed.
  logger.info({ userId, retainedAssetId: user.signatureAssetId }, "saved signature detached from profile");

  return { userId, hasSignature: false };
}

/**
 * Records a signature-management event on the audit trail.
 * Kept separate so the caller decides which document (if any) it belongs to.
 */
export async function auditSignatureChange(
  userId: number,
  action: "SIGNATURE_UPDATED" | "SIGNATURE_REMOVED",
  ipAddress?: string | null,
) {
  const openDocuments = await prisma.document.findFirst({
    where: {
      isDeleted: false,
      status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] },
      workflowInstances: { some: { steps: { some: { approverUserId: userId, status: "ACTIVE" } } } },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, currentVersion: true },
  });

  if (!openDocuments) return;

  await recordAudit({
    documentId: openDocuments.id,
    documentVersion: openDocuments.currentVersion,
    actorUserId: userId,
    action,
    reason:
      action === "SIGNATURE_UPDATED"
        ? "Signer replaced the signature used for future approvals. Historical approvals are unchanged."
        : "Signer removed the saved signature used for future approvals. Historical approvals are unchanged.",
    ipAddress,
  });
}