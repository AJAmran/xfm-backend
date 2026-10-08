import { NotificationType } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { invalidateByPrefix } from "../../lib/cache";
import { realtimeHub } from "../../lib/realtime";
import { logger } from "../../lib/logger";

/**
 * Document-module notifications.
 *
 * These are addressed to a single approver (`recipientUserId`) rather than a
 * branch, because a corporate approver must be notified regardless of which
 * branch raised the document. Failures are logged, never thrown: a notification
 * problem must not roll back a completed approval.
 */

const NOTIFICATIONS_PREFIX = "notifications_";

export interface DocumentNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  /** Recipient — the person who must act. */
  userId: number;
  documentId: number;
  /** Branch the document belongs to, for branch-scoped dashboard filtering. */
  branchId?: number | null;
  actorUserId?: number | null;
}

export async function notifyUser(input: DocumentNotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: input.type,
        title: input.title,
        message: input.message,
        recipientUserId: input.userId,
        actorUserId: input.actorUserId ?? null,
        branchId: input.branchId ?? null,
        documentId: input.documentId,
        entityId: input.documentId,
      },
    });
  } catch (error) {
    logger.warn({ err: error, documentId: input.documentId }, "document notification failed");
    return;
  }

  await invalidateByPrefix(NOTIFICATIONS_PREFIX);
  realtimeHub.publish({ entity: "document.notification", type: "global" });
}

/**
 * Broadcasts to many recipients (e.g. escalation to admins). Returns the number
 * created so the caller can log partial results.
 */
export async function notifyUsers(inputs: DocumentNotificationInput[]): Promise<number> {
  const unique = Array.from(
    new Map(inputs.filter((i) => i.userId > 0).map((i) => [i.userId, i])).values(),
  );
  if (!unique.length) return 0;

  try {
    const result = await prisma.notification.createMany({
      data: unique.map((input) => ({
        type: input.type,
        title: input.title,
        message: input.message,
        recipientUserId: input.userId,
        actorUserId: input.actorUserId ?? null,
        branchId: input.branchId ?? null,
        documentId: input.documentId,
        entityId: input.documentId,
      })),
    });
    await invalidateByPrefix(NOTIFICATIONS_PREFIX);
    realtimeHub.publish({ entity: "document.notification", type: "global" });
    return result.count;
  } catch (error) {
    logger.warn({ err: error, recipients: unique.length }, "document notification batch failed");
    return 0;
  }
}