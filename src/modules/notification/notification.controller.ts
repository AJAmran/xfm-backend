import { Request, Response } from "express";
import * as notificationService from "./notification.service";
import { successResponse } from "../../utils/apiResponse";
import { parsedQuery } from "../../middleware/validation";
import { NotificationQueryInput } from "./notification.validation";

export async function list(req: Request, res: Response) {
  const query = parsedQuery<NotificationQueryInput>(res);
  const result = await notificationService.getPaginatedNotifications(query, req.user!);
  successResponse(res, "Notifications retrieved successfully", result);
}

export async function unreadCount(req: Request, res: Response) {
  const result = await notificationService.getUnreadCount(req.user!);
  successResponse(res, "Unread notification count retrieved successfully", result);
}

export async function markRead(req: Request, res: Response) {
  const notification = await notificationService.markAsRead(Number(req.params.id), req.user!);
  successResponse(res, "Notification marked as read", notification);
}

export async function markAllRead(req: Request, res: Response) {
  const result = await notificationService.markAllRead(req.user!);
  successResponse(res, "All notifications marked as read", result);
}

export async function deleteOne(req: Request, res: Response) {
  const result = await notificationService.deleteNotification(Number(req.params.id), req.user!);
  successResponse(res, "Notification deleted successfully", result);
}
