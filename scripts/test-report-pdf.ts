/**
 * Dry-run: builds yesterday's booking matrix PDF to ./tmp/ without sending
 * mail. Run: npm run reports:pdf
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildDateMatrixPdf,
  buildMatrixCells,
  fetchRangeRows,
  systemScope,
} from "../src/lib/report-mailer";
import { getBookingReport } from "../src/modules/booking/booking.service";
import { getDhakaTodayString } from "../src/utils/dateHelpers";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const [y, m, d] = getDhakaTodayString().split("-").map(Number);
  const yday = new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);

  const scope = await systemScope();
  const report = await getBookingReport({ startDate: yday, endDate: yday }, scope);
  const rows = await fetchRangeRows(yday, yday);
  const branches = report.branchBreakdown.map((r) => ({ branchId: r.branchId, branchCode: r.branchCode, branchName: r.branchName }));
  const { days, branches: active, cells } = buildMatrixCells(yday, yday, rows, branches);
  const pdf = buildDateMatrixPdf("Daily Booking Report", `${yday}  |  All Branches`, days, active, cells);

  fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
  const out = path.join(process.cwd(), "tmp", `Booking_Report_${yday}.pdf`);
  fs.writeFileSync(out, pdf);
  console.log(`Wrote ${out} (${pdf.length} bytes, ${active.length} branches).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
