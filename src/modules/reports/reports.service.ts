import ExcelJS from "exceljs";
import { prisma } from "../../lib/prisma";

async function getFeedbacksInRange(start: Date, end: Date, branchId?: number) {
  const where: Record<string, unknown> = { submittedAt: { gte: start, lte: end } };
  if (branchId) where.branchId = branchId;

  return prisma.feedback.findMany({
    where,
    include: { branch: { select: { name: true, code: true } } },
    orderBy: { submittedAt: "desc" },
  });
}

async function getPeriodSummary(start: Date, end: Date, branchId?: number) {
  const where: Record<string, unknown> = { submittedAt: { gte: start, lte: end } };
  if (branchId) where.branchId = branchId;

  const [total, avg, negative] = await Promise.all([
    prisma.feedback.count({ where }),
    prisma.feedback.aggregate({ where, _avg: { overallRating: true } }),
    prisma.feedback.count({ where: { ...where, overallRating: { lte: 2 } } }),
  ]);

  return { total, averageRating: avg._avg.overallRating, negativeCount: negative };
}

export async function getDailyReport(branchId?: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400000);

  const [summary, feedbacks] = await Promise.all([
    getPeriodSummary(start, end, branchId),
    getFeedbacksInRange(start, end, branchId),
  ]);

  return { period: "daily", date: start.toISOString().slice(0, 10), summary, feedbacks };
}

export async function getWeeklyReport(branchId?: number) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = new Date(end.getTime() - 7 * 86400000);

  const [summary, feedbacks] = await Promise.all([
    getPeriodSummary(start, end, branchId),
    getFeedbacksInRange(start, end, branchId),
  ]);

  return { period: "weekly", start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), summary, feedbacks };
}

export async function getMonthlyReport(branchId?: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [summary, feedbacks] = await Promise.all([
    getPeriodSummary(start, end, branchId),
    getFeedbacksInRange(start, end, branchId),
  ]);

  return { period: "monthly", month: start.toISOString().slice(0, 7), summary, feedbacks };
}

export async function getBranchReport(branchId: number) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId, isDeleted: false } });
  if (!branch) return null;

  const [total, avg, negative, recent] = await Promise.all([
    prisma.feedback.count({ where: { branchId } }),
    prisma.feedback.aggregate({ where: { branchId }, _avg: { overallRating: true } }),
    prisma.feedback.count({ where: { branchId, overallRating: { lte: 2 } } }),
    prisma.feedback.findMany({ where: { branchId }, orderBy: { submittedAt: "desc" }, take: 20 }),
  ]);

  return { branch, summary: { total, averageRating: avg._avg.overallRating, negativeCount: negative }, recentFeedbacks: recent };
}

export async function exportExcel(branchId?: number, startDate?: string, endDate?: string) {
  const where: Record<string, unknown> = {};
  if (branchId) where.branchId = branchId;

  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.submittedAt = dateFilter;
  }

  const feedbacks = await prisma.feedback.findMany({
    where,
    include: { branch: { select: { name: true, code: true } } },
    orderBy: { submittedAt: "desc" },
    take: 10000,
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Feedbacks");

  sheet.columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Branch", key: "branch", width: 25 },
    { header: "Guest Name", key: "guestName", width: 25 },
    { header: "Contact", key: "contact", width: 20 },
    { header: "Food", key: "foodRating", width: 8 },
    { header: "Service", key: "serviceRating", width: 8 },
    { header: "Environment", key: "environmentRating", width: 8 },
    { header: "Event", key: "eventRating", width: 8 },
    { header: "Overall", key: "overallRating", width: 8 },
    { header: "Heard About", key: "heardAbout", width: 18 },
    { header: "Age Group", key: "ageGroup", width: 15 },
    { header: "Comment", key: "opinion", width: 40 },
    { header: "Date", key: "submittedAt", width: 20 },
  ];

  for (const f of feedbacks) {
    sheet.addRow({
      id: f.id,
      branch: f.branch.name,
      guestName: f.guestName,
      contact: f.contact,
      foodRating: f.foodRating,
      serviceRating: f.serviceRating,
      environmentRating: f.environmentRating,
      eventRating: f.eventRating,
      overallRating: f.overallRating,
      heardAbout: f.heardAbout,
      ageGroup: f.ageGroup,
      opinion: f.opinion,
      submittedAt: f.submittedAt.toISOString(),
    });
  }

  sheet.getRow(1).font = { bold: true };

  return workbook;
}
