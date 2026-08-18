import httpStatus from "http-status";
import { NotificationType } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { realtimeHub } from "../../lib/realtime";
import { withCache, invalidateByPrefix } from "../../lib/cache";
import { NotificationQueryInput } from "./notification.validation";

interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
}

const NOTIFICATION_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  actor: { select: { id: true, name: true, role: true } },
} as const;

// The bell polls the feed + unread count on every load/event. Notifications
// are append/read-only, so a short TTL makes those reads free; every create /
// read action invalidates the prefix.
const NOTIFICATIONS_PREFIX = "notifications_";
const NOTIFICATIONS_TTL = 10;

function notificationsScopeKey(user: AuthUser): string {
  return isManager(user) ? `bm_${user.branchId ?? "none"}` : "all";
}

async function invalidateNotificationsCaches(): Promise<void> {
  await invalidateByPrefix(NOTIFICATIONS_PREFIX);
}

function isManager(user: AuthUser): boolean {
  return user.role === "BRANCH_MANAGER";
}

/** Branch managers only ever see notifications for their own branch. */
function branchScope(user: AuthUser): { branchId: number } | null {
  return isManager(user) ? { branchId: user.branchId ?? -1 } : null;
}

export interface SubmissionNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  branchId: number;
  entityId: number | null;
  actorUserId: number;
}

/**
 * Persist a submission notification and broadcast a `notification.created`
 * realtime event (branch-scoped so admins receive it and the submitting
 * manager sees their own confirmation).
 */
export async function createSubmissionNotification(input: SubmissionNotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      type: input.type,
      title: input.title,
      message: input.message,
      branchId: input.branchId,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
    },
  });

  await invalidateNotificationsCaches();

  realtimeHub.publish({
    entity: "notification.created",
    type: "branch",
    branchId: input.branchId,
  });

  return notification;
}

export async function getPaginatedNotifications(query: NotificationQueryInput, user: AuthUser) {
  const key = `${NOTIFICATIONS_PREFIX}list_${notificationsScopeKey(user)}:${JSON.stringify(query)}`;

  return withCache(key, async () => {
    const pagination = transformPagination(query);
    const scope = branchScope(user);
    const where: Record<string, unknown> = { ...(scope ?? {}) };
    if (query.unreadOnly === "true") where.read = false;

    const [data, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        ...pagination,
        include: NOTIFICATION_INCLUDE,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      data: data.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        branchName: n.branch?.name ?? null,
        branchCode: n.branch?.code ?? null,
        actorName: n.actor?.name ?? null,
        entityId: n.entityId,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      meta: buildMetadata(total, pagination),
    };
  }, NOTIFICATIONS_TTL);
}

export async function getUnreadCount(user: AuthUser) {
  const key = `${NOTIFICATIONS_PREFIX}unread_${notificationsScopeKey(user)}`;

  return withCache(key, async () => {
    const scope = branchScope(user);
    const count = await prisma.notification.count({
      where: { read: false, ...(scope ?? {}) },
    });
    return { count };
  }, NOTIFICATIONS_TTL);
}

export async function markAsRead(id: number, user: AuthUser) {
  const scope = branchScope(user);
  const existing = await prisma.notification.findFirst({
    where: { id, ...(scope ?? {}) },
    select: { id: true },
  });
  if (!existing) throw appError("Notification not found", httpStatus.NOT_FOUND);

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true, readAt: new Date() },
  });
  await invalidateNotificationsCaches();
  return updated;
}

export async function markAllRead(user: AuthUser) {
  const scope = branchScope(user);
  const result = await prisma.notification.updateMany({
    where: { read: false, ...(scope ?? {}) },
    data: { read: true, readAt: new Date() },
  });
  await invalidateNotificationsCaches();
  return { count: result.count };
}

export async function deleteNotification(id: number, user: AuthUser) {
  const scope = branchScope(user);
  const existing = await prisma.notification.findFirst({
    where: { id, ...(scope ?? {}) },
    select: { id: true },
  });
  if (!existing) throw appError("Notification not found", httpStatus.NOT_FOUND);

  await prisma.notification.delete({ where: { id } });
  await invalidateNotificationsCaches();
  return { id };
}
