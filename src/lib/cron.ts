import cron from "node-cron";
import { logger } from "./logger";
import { isMailConfigured } from "./mailer";
import { sendDailyBookingReport, sendMonthlyBookingReports } from "./report-mailer";
import { getDhakaTodayString } from "../utils/dateHelpers";

const DHAKA_TZ = "Asia/Dhaka";

/** True on the last calendar day of the month (Dhaka time). */
function isMonthEnd(): boolean {
  const [y, m, d] = getDhakaTodayString().split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return d === lastDay;
}

/**
 * Scheduled booking reports (Asia/Dhaka wall-clock):
 * - Daily 00:01 → today's matrix PDF to REPORT_MAIL_TO.
 * - Month-end 23:55 → current (just-completed) month as 4 weekly PDFs
 *   in one mail (node-cron has no "last day" syntax, so the handler
 *   checks the calendar itself).
 * Jobs no-op with a warning when SMTP is not configured.
 */
export function startCronJobs(): void {
  cron.schedule(
    "1 0 * * *",
    () => {
      sendDailyBookingReport().catch((err) => logger.error({ err }, "Cron(daily-report): failed."));
    },
    { timezone: "Asia/Dhaka" },
  );

  cron.schedule(
    "55 23 * * *",
    () => {
      if (!isMonthEnd()) return;
      sendMonthlyBookingReports().catch((err) => logger.error({ err }, "Cron(monthly-report): failed."));
    },
    { timezone: "Asia/Dhaka" },
  );

  logger.info(
    { tz: DHAKA_TZ, mailConfigured: isMailConfigured() },
    "cron jobs scheduled (daily 00:01, month-end 23:55)",
  );
}
