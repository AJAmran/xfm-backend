import { Request, Response } from "express";
import httpStatus from "http-status";
import * as bookingService from "./booking.service";
import { successResponse } from "../../utils/apiResponse";
import { parsedQuery } from "../../middleware/validation";
import { BookingQueryInput, BookingReportQueryInput } from "./booking.validation";

export async function create(req: Request, res: Response) {
  const booking = await bookingService.createBooking(req.body, req.user!);
  successResponse(res, "Booking created successfully", booking, httpStatus.CREATED);
}

export async function list(req: Request, res: Response) {
  const query = parsedQuery<BookingQueryInput>(res);
  const result = await bookingService.getPaginatedBookings(query, req.user!);
  successResponse(res, "Bookings retrieved successfully", result);
}

export async function getById(req: Request, res: Response) {
  const booking = await bookingService.getBookingById(Number(req.params.id), req.user!);
  successResponse(res, "Booking retrieved successfully", booking);
}

export async function update(req: Request, res: Response) {
  const booking = await bookingService.updateBooking(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Booking updated successfully", booking);
}

export async function remove(req: Request, res: Response) {
  await bookingService.deleteBooking(Number(req.params.id), req.user!);
  successResponse(res, "Booking deleted successfully", {});
}

export async function adjustPax(req: Request, res: Response) {
  const adjustment = await bookingService.addPaxAdjustment(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Pax adjustment recorded successfully", adjustment, httpStatus.CREATED);
}

export async function paxHistory(req: Request, res: Response) {
  const history = await bookingService.getPaxHistory(Number(req.params.id), req.user!);
  successResponse(res, "Pax history retrieved successfully", history);
}

export async function setActualPax(req: Request, res: Response) {
  const booking = await bookingService.setActualPax(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Actual pax saved successfully", booking);
}

export async function setStatus(req: Request, res: Response) {
  const booking = await bookingService.setBookingStatus(Number(req.params.id), req.body, req.user!);
  successResponse(res, "Booking status updated successfully", booking);
}

export async function statusHistory(req: Request, res: Response) {
  const history = await bookingService.getStatusHistory(Number(req.params.id), req.user!);
  successResponse(res, "Status history retrieved successfully", history);
}

export async function timeline(req: Request, res: Response) {
  const timeline = await bookingService.getBookingTimeline(Number(req.params.id), req.user!);
  successResponse(res, "Booking timeline retrieved successfully", timeline);
}

export async function dashboard(req: Request, res: Response) {
  const result = await bookingService.getDashboard(req.user!, { branchId: req.query.branchId as string | undefined });
  successResponse(res, "Booking dashboard retrieved successfully", result);
}

export async function upcoming(req: Request, res: Response) {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const result = await bookingService.getUpcoming(req.user!, limit, branchId);
  successResponse(res, "Upcoming bookings retrieved successfully", result);
}

export async function calendar(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  const result = await bookingService.getCalendar(req.user!, {
    startDate: q.startDate,
    endDate: q.endDate,
    branchId: q.branchId,
    partyType: q.partyType as "LUNCH" | "DINNER" | undefined,
    status: q.status as "TENTATIVE" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | undefined,
  });
  successResponse(res, "Booking calendar retrieved successfully", result);
}

export async function warnings(req: Request, res: Response) {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const result = await bookingService.getWarnings(req.user!, branchId);
  successResponse(res, "Booking warnings retrieved successfully", result);
}

export async function report(req: Request, res: Response) {
  const query = parsedQuery<BookingReportQueryInput>(res);
  const result = await bookingService.getBookingReport(query, req.user!);
  successResponse(res, "Booking report retrieved successfully", result);
}

export async function dailyReport(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  const result = await bookingService.getDailyReport(q.date, req.user!, q.branchId);
  successResponse(res, "Daily booking report retrieved successfully", result);
}

export async function weeklyReport(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  const result = await bookingService.getWeeklyReport(q.date, req.user!, q.branchId);
  successResponse(res, "Weekly booking report retrieved successfully", result);
}

export async function monthlyReport(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  const result = await bookingService.getMonthlyReport(q.month, req.user!, q.branchId);
  successResponse(res, "Monthly booking report retrieved successfully", result);
}

export async function exportExcel(req: Request, res: Response) {
  const query = parsedQuery<BookingReportQueryInput>(res);
  const workbook = await bookingService.exportBookingsExcel(query, req.user!);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=bookings.xlsx");
  await workbook.xlsx.write(res);
  res.end();
}
