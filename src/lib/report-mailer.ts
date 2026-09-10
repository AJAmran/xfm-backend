import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ejs from "ejs";
import { prisma } from "./prisma";
import { transporter, isMailConfigured } from "./mailer";
import env from "../config/env";
import { logger } from "./logger";
import {
  getBookingReport,
  type BookingReportResult,
} from "../modules/booking/booking.service";
import { getDhakaTodayString, formatDateOnly } from "../utils/dateHelpers";
import {
  BOOKING_REPORT_TEMPLATE,
  type BookingReportMailData,
} from "../templates/booking-report.template";

interface MailAttachment {
  filename: string;
  content: Buffer;
}

/** All-branch scope for automated reports (data identical for every role). */
export async function systemScope() {
  const admin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN", isDeleted: false },
    select: { id: true },
  });
  return {
    id: admin?.id ?? 0,
    role: "SUPER_ADMIN" as const,
    branchId: null as number | null,
  };
}

function fmtDay(iso: string): string {
  return formatDateOnly(new Date(`${iso}T00:00:00.000Z`));
}

/** B&W date-matrix PDF: dates across the top (L|D each), one row per branch. */
export function buildDateMatrixPdf(
  title: string,
  subtitle: string,
  days: string[],
  branches: Array<{ branchId: number; branchCode: string; branchName?: string }>,
  cells: Map<number, Map<string, { lunchPax: number; dinnerPax: number; lunchT: number; lunchC: number; dinnerT: number; dinnerC: number }>>,
): Buffer {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const cell = (pax: number, t: number, c: number) =>
    pax === 0 ? "-" : `${pax}\n(T${t}/C${c})`;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("X-Group Hospitality", 8, 14);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(title, 8, 20);
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(subtitle, 8, 26);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.line(8, 29, pageWidth - 8, 29);

  const footer = (hook: { pageNumber: number }) => {
    const count = doc.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `X-Group Hospitality - Booking Report - Page ${hook.pageNumber} of ${count}`,
      pageWidth - 8,
      doc.internal.pageSize.getHeight() - 8,
      { align: "right" },
    );
  };

  const dayTotals = new Map<string, { lunchPax: number; dinnerPax: number; lunchT: number; lunchC: number; dinnerT: number; dinnerC: number }>();
  for (const [, byDate] of cells) {
    for (const [key, v] of byDate) {
      const t = dayTotals.get(key) ?? { lunchPax: 0, dinnerPax: 0, lunchT: 0, lunchC: 0, dinnerT: 0, dinnerC: 0 };
      t.lunchPax += v.lunchPax;
      t.dinnerPax += v.dinnerPax;
      t.lunchT += v.lunchT;
      t.lunchC += v.lunchC;
      t.dinnerT += v.dinnerT;
      t.dinnerC += v.dinnerC;
      dayTotals.set(key, t);
    }
  }
  const hasLunch = (key: string) => (dayTotals.get(key)?.lunchPax ?? 0) > 0;
  const hasDinner = (key: string) => (dayTotals.get(key)?.dinnerPax ?? 0) > 0;

  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    const y = i === 0 ? 38 : ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 38);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(days.length > 7 ? `Date Matrix (part ${i / 7 + 1})` : "Date Matrix - guests per day, per branch", 8, y + 6);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text("T = Tentative pax | C = Confirmed pax (includes completed) | Cancelled excluded", 8, y + 10);
    autoTable(doc, {
      head: [
        [
          { content: "Branch", rowSpan: 2 },
          ...chunk.map((key) => {
            const m = { lunch: hasLunch(key), dinner: hasDinner(key) };
            return {
              content: fmtDay(key),
              colSpan: (m.lunch ? 1 : 0) + (m.dinner ? 1 : 0) || 1,
            };
          }),
        ],
        [...chunk.flatMap((key) => {
          const m = { lunch: hasLunch(key), dinner: hasDinner(key) };
          if (!m.lunch && !m.dinner) return ["-"];
          return [...(m.lunch ? ["L"] : []), ...(m.dinner ? ["D"] : [])];
        })],
      ],
      body: branches.map((b) => {
        const byDate = cells.get(b.branchId);
        // Short range: full name; 7+ days: code only (space).
        const branchLabel =
          days.length >= 7 || !b.branchName ? b.branchCode : `${b.branchCode} - ${b.branchName}`;
        return [
          branchLabel,
          ...chunk.flatMap((key) => {
            const v = byDate?.get(key);
            const m = { lunch: hasLunch(key), dinner: hasDinner(key) };
            if (!m.lunch && !m.dinner) return ["-"];
            return [
              ...(m.lunch ? [cell(v?.lunchPax ?? 0, v?.lunchT ?? 0, v?.lunchC ?? 0)] : []),
              ...(m.dinner ? [cell(v?.dinnerPax ?? 0, v?.dinnerT ?? 0, v?.dinnerC ?? 0)] : []),
            ];
          }),
        ];
      }),
      foot: [[
        "TOTAL",
        ...chunk.flatMap((key) => {
          const t = dayTotals.get(key);
          const m = { lunch: hasLunch(key), dinner: hasDinner(key) };
          if (!m.lunch && !m.dinner) return ["-"];
          return [
            ...(m.lunch ? [cell(t?.lunchPax ?? 0, t?.lunchT ?? 0, t?.lunchC ?? 0)] : []),
            ...(m.dinner ? [cell(t?.dinnerPax ?? 0, t?.dinnerT ?? 0, t?.dinnerC ?? 0)] : []),
          ];
        }),
      ]],
      startY: y + 14,
      margin: { top: 34, right: 8, bottom: 12, left: 8 },
      tableLineWidth: 0.6,
      tableLineColor: [0, 0, 0],
      styles: { fontSize: 7, halign: "center", lineWidth: 0.5, lineColor: [0, 0, 0], textColor: [0, 0, 0] },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", lineWidth: 0.5, lineColor: [0, 0, 0] },
      footStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: "bold", lineWidth: 0.5, lineColor: [0, 0, 0] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      theme: "grid",
      didDrawPage: footer,
    });
  }

  let grandLunch = 0;
  let grandDinner = 0;
  for (const [, t] of dayTotals) {
    grandLunch += t.lunchPax;
    grandDinner += t.dinnerPax;
  }
  const grandY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 38;
  doc.setFillColor(0, 0, 0);
  doc.rect(8, grandY + 4, pageWidth - 16, 12, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(
    `GRAND TOTAL - Lunch ${grandLunch} pax - Dinner ${grandDinner} pax - Total ${grandLunch + grandDinner} guests`,
    pageWidth / 2,
    grandY + 12,
    { align: "center" },
  );

  return Buffer.from(doc.output("arraybuffer"));
}

interface MatrixRow {
  branchId: number;
  branchCode: string;
  partyDate: string;
  partyType: string;
  status: string;
  expectedPax: number;
}

/** Aggregate raw bookings into per-branch × per-day × meal cells + day list. */
export function buildMatrixCells(
  startDate: string,
  endDate: string,
  rows: MatrixRow[],
  branches: Array<{ branchId: number; branchCode: string }>,
) {
  const days: string[] = [];
  {
    const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
    for (let t = start; t <= end; t += 86400000) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
  }
  const cells = new Map<number, Map<string, { lunchPax: number; dinnerPax: number; lunchT: number; lunchC: number; dinnerT: number; dinnerC: number }>>();
  const blank = () => ({ lunchPax: 0, dinnerPax: 0, lunchT: 0, lunchC: 0, dinnerT: 0, dinnerC: 0 });
  for (const b of rows) {
    if (b.status === "CANCELLED") continue;
    const key = b.partyDate.slice(0, 10);
    if (!days.includes(key)) continue;
    let byDate = cells.get(b.branchId);
    if (!byDate) {
      byDate = new Map();
      cells.set(b.branchId, byDate);
    }
    const cell = byDate.get(key) ?? blank();
    const isLunch = b.partyType === "LUNCH";
    if (isLunch) {
      cell.lunchPax += b.expectedPax;
      if (b.status === "TENTATIVE") cell.lunchT += b.expectedPax;
      else cell.lunchC += b.expectedPax;
    } else {
      cell.dinnerPax += b.expectedPax;
      if (b.status === "TENTATIVE") cell.dinnerT += b.expectedPax;
      else cell.dinnerC += b.expectedPax;
    }
    byDate.set(key, cell);
  }
  const activeBranches = branches.filter((br) => {
    const byDate = cells.get(br.branchId);
    if (!byDate) return false;
    for (const [, c] of byDate) {
      if (c.lunchPax > 0 || c.dinnerPax > 0) return true;
    }
    return false;
  });
  return { days, branches: activeBranches, cells };
}

/** Fetch raw bookings for a range (all branches, non-deleted). */
export async function fetchRangeRows(startDate: string, endDate: string) {
  const bookings = await prisma.booking.findMany({
    where: {
      isDeleted: false,
      partyDate: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      },
    },
    select: {
      branchId: true,
      branch: { select: { code: true } },
      partyDate: true,
      partyType: true,
      status: true,
      expectedPax: true,
    },
    orderBy: [{ branchId: "asc" }, { partyDate: "asc" }],
    take: env.report_export_limit,
  });
  return bookings.map((b) => ({
    branchId: b.branchId,
    branchCode: b.branch.code,
    partyDate: formatDateOnly(b.partyDate),
    partyType: b.partyType,
    status: b.status,
    expectedPax: b.expectedPax,
  }));
}

async function sendMail(to: string, subject: string, data: BookingReportMailData, attachments: MailAttachment[]) {
  const html = ejs.render(BOOKING_REPORT_TEMPLATE, data);
  await transporter.sendMail({
    from: env.email_sender,
    to,
    subject,
    html,
    attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })),
  });
}

function toMailData(title: string, subtitle: string, report: BookingReportResult): BookingReportMailData {
  const s = report.summary;
  return {
    title,
    subtitle,
    summary: {
      total: s.total,
      tentative: s.tentative,
      confirmed: s.confirmed,
      completed: s.completed,
      lunch: s.lunch,
      dinner: s.dinner,
      lunchPax: s.lunchPax,
      dinnerPax: s.dinnerPax,
      actualPax: s.actualPax,
    },
  };
}

/** Nightly job: today's full report (matrix PDF) at 00:01 Dhaka time. */
export async function sendDailyBookingReport(): Promise<void> {
  if (!isMailConfigured() || !env.report_mail_to) {
    logger.warn("Cron(daily-report): SMTP not configured — skipping.");
    return;
  }
  const scope = await systemScope();
  const today = getDhakaTodayString();
  const report = await getBookingReport({ startDate: today, endDate: today }, scope);
  const rows = await fetchRangeRows(today, today);
  const branches = report.branchBreakdown.map((r) => ({ branchId: r.branchId, branchCode: r.branchCode, branchName: r.branchName }));
  const { days, branches: active, cells } = buildMatrixCells(today, today, rows, branches);
  const pdf = buildDateMatrixPdf(
    "Daily Booking Report",
    `${today}  |  All Branches`,
    days,
    active,
    cells,
  );
  await sendMail(
    env.report_mail_to,
    `Daily Booking Report — ${today} (X-Group)`,
    toMailData("Daily Booking Report", `${today} · All Branches · ${report.summary.total} bookings, ${report.summary.expectedPax} expected guests`, report),
    [{ filename: `Booking_Report_${today}.pdf`, content: pdf }],
  );
  logger.info({ date: today }, "Cron(daily-report): mailed.");
}

/** Split a YYYY-MM month into 4 fixed weeks: 1–7, 8–14, 15–21, 22–last. */
export function splitMonthWeeks(yearMonth: string): Array<{ start: string; end: string; label: string }> {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const cuts: Array<[number, number]> = [
    [1, Math.min(7, lastDay)],
    [8, Math.min(14, lastDay)],
    [15, Math.min(21, lastDay)],
    [22, lastDay],
  ];
  return cuts.map(([s, e], i) => ({
    start: `${yearMonth}-${pad(s)}`,
    end: `${yearMonth}-${pad(e)}`,
    label: `Week ${i + 1} (${pad(s)}–${pad(e)} ${yearMonth})`,
  }));
}

/** Monthly job: the CURRENT month (month-to-date) as 4 weekly PDFs in one mail.
 *  Triggered on the month's last night (see cron.ts) so the month is complete. */
export async function sendMonthlyBookingReports(): Promise<void> {
  if (!isMailConfigured() || !env.report_mail_to) {
    logger.warn("Cron(monthly-report): SMTP not configured — skipping.");
    return;
  }
  const scope = await systemScope();
  const currentYm = getDhakaTodayString().slice(0, 7);
  const weeks = splitMonthWeeks(currentYm);

  const attachments: MailAttachment[] = [];
  let monthTotal = 0;
  let monthPax = 0;
  for (const [i, w] of weeks.entries()) {
    const report = await getBookingReport({ startDate: w.start, endDate: w.end }, scope);
    const rows = await fetchRangeRows(w.start, w.end);
    const branches = report.branchBreakdown.map((r) => ({ branchId: r.branchId, branchCode: r.branchCode, branchName: r.branchName }));
    const { days, branches: active, cells } = buildMatrixCells(w.start, w.end, rows, branches);
    monthTotal += report.summary.total;
    monthPax += report.summary.expectedPax;
    const pdf = buildDateMatrixPdf(
      `Weekly Booking Report — ${w.label}`,
      `${w.start} to ${w.end}  |  All Branches`,
      days,
      active,
      cells,
    );
    attachments.push({ filename: `Booking_Report_${currentYm}_W${i + 1}.pdf`, content: pdf });
  }

  const monthReport = await getBookingReport({ startDate: `${currentYm}-01`, endDate: weeks[3]!.end }, scope);
  await sendMail(
    env.report_mail_to,
    `Monthly Booking Reports — ${currentYm} (4 weeks, X-Group)`,
    toMailData(
      `Monthly Booking Reports — ${currentYm}`,
      `${currentYm} · 4 weekly PDFs attached · ${monthTotal} bookings, ${monthPax} expected guests`,
      monthReport,
    ),
    attachments,
  );
  logger.info({ month: currentYm }, "Cron(monthly-report): mailed 4 weekly PDFs.");
}
