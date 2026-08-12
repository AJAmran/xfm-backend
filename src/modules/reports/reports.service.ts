import ExcelJS from "exceljs";
import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import env from "../../config/env";
import { formatDateOnly, toDateOnly, toEndOfDay, toMonthStart, toNextMonthStart } from "../../utils/dateHelpers";

async function getFeedbacksInRange(start: Date, end: Date, branchId?: number) {
  const where: Prisma.GuestFeedbackWhereInput = { submittedAt: { gte: start, lte: end } };
  if (branchId) where.branchId = branchId;

  return prisma.guestFeedback.findMany({
    where,
    include: { branch: { select: { name: true, code: true } } },
    orderBy: { submittedAt: "desc" },
    take: env.report_fetch_limit,
  });
}

async function getPeriodSummary(start: Date, end: Date, branchId?: number) {
  const where: Prisma.GuestFeedbackWhereInput = { submittedAt: { gte: start, lte: end } };
  if (branchId) where.branchId = branchId;

  const [total, avg, negative] = await Promise.all([
    prisma.guestFeedback.count({ where }),
    prisma.guestFeedback.aggregate({ where, _avg: { overallRating: true } }),
    prisma.guestFeedback.count({ where: { ...where, overallRating: { lte: 2 } } }),
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
  if (!branch) throw appError("Branch not found", httpStatus.NOT_FOUND);

  const [total, avg, negative, recent] = await Promise.all([
    prisma.guestFeedback.count({ where: { branchId } }),
    prisma.guestFeedback.aggregate({ where: { branchId }, _avg: { overallRating: true } }),
    prisma.guestFeedback.count({ where: { branchId, overallRating: { lte: 2 } } }),
    prisma.guestFeedback.findMany({ where: { branchId }, orderBy: { submittedAt: "desc" }, take: 20 }),
  ]);

  return { branch, summary: { total, averageRating: avg._avg.overallRating, negativeCount: negative }, recentFeedbacks: recent };
}

export async function exportExcel(branchId?: number, startDate?: string, endDate?: string) {
  const where: Prisma.GuestFeedbackWhereInput = {};
  if (branchId) where.branchId = branchId;

  if (startDate || endDate) {
    const dateFilter: Prisma.DateTimeFilter<"GuestFeedback"> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.submittedAt = dateFilter;
  }

  const feedbacks = await prisma.guestFeedback.findMany({
    where,
    include: { branch: { select: { name: true, code: true } } },
    orderBy: { submittedAt: "desc" },
    take: env.report_export_limit,
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

// ─── Excel exports for the operational modules ────────────────────────────────

function buildDateRange(startDate?: string, endDate?: string, field: "reportDate" | "logDate" = "logDate") {
  const range: { gte?: Date; lte?: Date } = {};
  if (startDate) range.gte = toDateOnly(startDate);
  if (endDate) range.lte = toEndOfDay(endDate);
  return Object.keys(range).length ? range : undefined;
}

export async function exportManagerReportsExcel(branchId?: number, startDate?: string, endDate?: string) {
  const where: Prisma.ManagerReportWhereInput = { isDeleted: false };
  if (branchId) where.branchId = branchId;
  const dateRange = buildDateRange(startDate, endDate, "reportDate");
  if (dateRange) where.reportDate = dateRange;

  const reports = await prisma.managerReport.findMany({
    where,
    include: {
      branch: { select: { name: true, code: true } },
      complaints: true,
      bpCpEntries: true,
    },
    orderBy: { reportDate: "desc" },
    take: env.report_export_limit,
  });

  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("Manager Reports");
  summarySheet.columns = [
    { header: "ID", key: "id", width: 6 },
    { header: "Branch", key: "branch", width: 25 },
    { header: "Manager", key: "managerName", width: 22 },
    { header: "Date", key: "reportDate", width: 12 },
    { header: "Manager Comments", key: "managerComments", width: 40 },
    { header: "Supply / Purchase Issues", key: "supplyPurchaseIssues", width: 40 },
    { header: "Briefing Points", key: "briefingPoints", width: 40 },
    { header: "Daily Learnings", key: "dailyLearnings", width: 40 },
    { header: "Complaints", key: "complaintCount", width: 10 },
    { header: "BP/CP Entries", key: "bpCpCount", width: 12 },
  ];
  for (const r of reports) {
    summarySheet.addRow({
      id: r.id,
      branch: r.branch.name,
      managerName: r.managerName,
      reportDate: formatDateOnly(r.reportDate),
      managerComments: r.managerComments,
      supplyPurchaseIssues: r.supplyPurchaseIssues,
      briefingPoints: r.briefingPoints,
      dailyLearnings: r.dailyLearnings,
      complaintCount: r.complaints.length,
      bpCpCount: r.bpCpEntries.length,
    });
  }
  summarySheet.getRow(1).font = { bold: true };

  const complaintSheet = workbook.addWorksheet("Guest Complaints");
  complaintSheet.columns = [
    { header: "Report ID", key: "reportId", width: 10 },
    { header: "Branch", key: "branch", width: 25 },
    { header: "Guest Name", key: "guestName", width: 20 },
    { header: "Mobile", key: "mobile", width: 15 },
    { header: "Email", key: "email", width: 22 },
    { header: "Complaint Details", key: "complaintDetails", width: 45 },
    { header: "Service Provider", key: "serviceProviderName", width: 20 },
    { header: "Responsible Person", key: "responsiblePerson", width: 20 },
    { header: "Action Taken", key: "actionTaken", width: 35 },
    { header: "Solution", key: "solution", width: 35 },
  ];
  for (const r of reports) {
    for (const c of r.complaints) {
      complaintSheet.addRow({
        reportId: r.id,
        branch: r.branch.name,
        guestName: c.guestName,
        mobile: c.mobile,
        email: c.email ?? "",
        complaintDetails: c.complaintDetails,
        serviceProviderName: c.serviceProviderName,
        responsiblePerson: c.responsiblePerson,
        actionTaken: c.actionTaken,
        solution: c.solution,
      });
    }
  }
  complaintSheet.getRow(1).font = { bold: true };

  return workbook;
}

export async function exportDiscountLogsExcel(branchId?: number, startDate?: string, endDate?: string) {
  const where: Prisma.GuestDiscountLogWhereInput = { isDeleted: false };
  if (branchId) where.branchId = branchId;
  const dateRange = buildDateRange(startDate, endDate, "logDate");
  if (dateRange) where.logDate = dateRange;

  const logs = await prisma.guestDiscountLog.findMany({
    where,
    include: {
      branch: { select: { name: true, code: true } },
      offeredBy: { select: { name: true } },
    },
    orderBy: { logDate: "desc" },
    take: env.report_export_limit,
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Discount Logs");
  sheet.columns = [
    { header: "ID", key: "id", width: 6 },
    { header: "Branch", key: "branch", width: 25 },
    { header: "Date", key: "logDate", width: 12 },
    { header: "Guest Name", key: "guestName", width: 20 },
    { header: "Mobile", key: "mobile", width: 15 },
    { header: "Lunch", key: "hadLunch", width: 8 },
    { header: "Dinner", key: "hadDinner", width: 8 },
    { header: "Total Bill", key: "totalBill", width: 12 },
    { header: "Discount %", key: "discountPercent", width: 12 },
    { header: "Discount Amount", key: "discountAmount", width: 16 },
    { header: "Reason", key: "reasonForDiscount", width: 40 },
    { header: "Offered By", key: "offeredBy", width: 20 },
    { header: "Status", key: "approvalStatus", width: 12 },
    { header: "Approved At", key: "approvedAt", width: 20 },
  ];
  for (const l of logs) {
    sheet.addRow({
      id: l.id,
      branch: l.branch.name,
      logDate: formatDateOnly(l.logDate),
      guestName: l.guestName,
      mobile: l.mobile,
      hadLunch: l.hadLunch ? "Yes" : "No",
      hadDinner: l.hadDinner ? "Yes" : "No",
      totalBill: Number(l.totalBill),
      discountPercent: Number(l.discountPercent),
      discountAmount: Number(l.discountAmount),
      reasonForDiscount: l.reasonForDiscount,
      offeredBy: l.offeredBy.name,
      approvalStatus: l.approvalStatus,
      approvedAt: l.approvedAt ? l.approvedAt.toISOString() : "",
    });
  }
  sheet.getRow(1).font = { bold: true };
  return workbook;
}

export async function exportEntertainmentLogsExcel(branchId?: number, startDate?: string, endDate?: string) {
  const where: Prisma.GuestEntertainmentLogWhereInput = { isDeleted: false };
  if (branchId) where.branchId = branchId;
  const dateRange = buildDateRange(startDate, endDate, "logDate");
  if (dateRange) where.logDate = dateRange;

  const logs = await prisma.guestEntertainmentLog.findMany({
    where,
    include: {
      branch: { select: { name: true, code: true } },
      offeredBy: { select: { name: true } },
    },
    orderBy: { logDate: "desc" },
    take: env.report_export_limit,
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Entertainment Logs");
  sheet.columns = [
    { header: "ID", key: "id", width: 6 },
    { header: "Branch", key: "branch", width: 25 },
    { header: "Date", key: "logDate", width: 12 },
    { header: "Guest Name", key: "guestName", width: 20 },
    { header: "Mobile", key: "mobile", width: 15 },
    { header: "Lunch", key: "hadLunch", width: 8 },
    { header: "Dinner", key: "hadDinner", width: 8 },
    { header: "Food Name", key: "foodName", width: 22 },
    { header: "Food Cost", key: "foodCost", width: 12 },
    { header: "Reason", key: "reasonForEntertainment", width: 40 },
    { header: "Offered By", key: "offeredBy", width: 20 },
    { header: "Status", key: "approvalStatus", width: 12 },
    { header: "Approved At", key: "approvedAt", width: 20 },
  ];
  for (const l of logs) {
    sheet.addRow({
      id: l.id,
      branch: l.branch.name,
      logDate: formatDateOnly(l.logDate),
      guestName: l.guestName,
      mobile: l.mobile,
      hadLunch: l.hadLunch ? "Yes" : "No",
      hadDinner: l.hadDinner ? "Yes" : "No",
      foodName: l.foodName,
      foodCost: Number(l.foodCost),
      reasonForEntertainment: l.reasonForEntertainment,
      offeredBy: l.offeredBy.name,
      approvalStatus: l.approvalStatus,
      approvedAt: l.approvedAt ? l.approvedAt.toISOString() : "",
    });
  }
  sheet.getRow(1).font = { bold: true };
  return workbook;
}

export async function exportInventoryExcel(branchId?: number, statementMonth?: string) {
  const monthStart = statementMonth ? toMonthStart(statementMonth) : new Date();
  const start = toMonthStart(monthStart.toISOString().slice(0, 7));
  const end = toNextMonthStart(monthStart.toISOString().slice(0, 7));

  const where: Prisma.MonthlyInventoryStatementWhereInput = {
    isDeleted: false,
    statementMonth: { gte: start, lt: end },
  };
  if (branchId) where.branchId = branchId;

  const statements = await prisma.monthlyInventoryStatement.findMany({
    where,
    include: {
      branch: { select: { name: true, code: true } },
      lines: {
        include: {
          item: {
            select: { name: true, category: { select: { name: true, sortOrder: true } } },
          },
        },
      },
    },
    orderBy: { branchId: "asc" },
    take: env.report_export_limit,
  });

  const workbook = new ExcelJS.Workbook();

  for (const stmt of statements) {
    const sheet = workbook.addWorksheet(
      `${stmt.branch.code || `B${stmt.branchId}`}_${start.toISOString().slice(0, 7)}`,
    );
    sheet.columns = [
      { header: "Category", key: "category", width: 22 },
      { header: "Item", key: "item", width: 26 },
      { header: "Opening", key: "openingStock", width: 10 },
      { header: "Added", key: "added", width: 10 },
      { header: "Broken / Lost", key: "brokenLost", width: 12 },
      { header: "Reject", key: "reject", width: 10 },
      { header: "Closing", key: "closingStock", width: 10 },
    ];
    const sortedLines = [...stmt.lines].sort(
      (a, b) =>
        a.item.category.sortOrder - b.item.category.sortOrder || a.item.name.localeCompare(b.item.name),
    );
    for (const line of sortedLines) {
      sheet.addRow({
        category: line.item.category.name,
        item: line.item.name,
        openingStock: line.openingStock,
        added: line.added,
        brokenLost: line.brokenLost,
        reject: line.reject,
        closingStock: line.closingStock,
      });
    }
    sheet.getRow(1).font = { bold: true };
  }

  if (statements.length === 0) {
    workbook.addWorksheet("No Data");
  }

  return workbook;
}
