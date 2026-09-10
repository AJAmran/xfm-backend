import cron from "node-cron";
import { logger } from "./logger";
import { isMailConfigured } from "./mailer";
import { sendDailyBookingReport, sendMonthlyBookingReports } from "./report-mailer";

const DHAKA_TZ = "Asia/Dhaka";

/**
 * Scheduled booking reports (Asia/Dhaka wall-clock):
 * - Daily 00:01 → yesterday's matrix PDF to REPORT_MAIL_TO.
 * - Monthly 1st 00:05 → previous month as 4 weekly PDFs in one mail.
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
    "5 0 1 * *",
    () => {
      sendMonthlyBookingReports().catch((err) => logger.error({ err }, "Cron(monthly-report): failed."));
    },
    { timezone: "Asia/Dhaka" },
  );

  logger.info(
    { tz: DHAKA_TZ, mailConfigured: isMailConfigured() },
    "cron jobs scheduled (daily 00:01, monthly 1st 00:05)",
  );
}
