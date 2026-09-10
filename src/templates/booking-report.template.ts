/**
 * EJS email body for booking reports (b7-style templating, bundled as a TS
 * module so it ships inside dist/ without extra copy steps).
 */
export const BOOKING_REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title><%= title %></title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; background: #f4f4f4; color: #111; margin: 0; padding: 0; }
      .container { max-width: 560px; margin: 32px auto; background: #ffffff; border: 1px solid #ddd; border-radius: 8px; padding: 28px; }
      .brand { font-size: 13px; font-weight: bold; letter-spacing: 2px; color: #555; text-transform: uppercase; }
      h1 { font-size: 20px; margin: 8px 0 4px; color: #000; }
      .sub { font-size: 13px; color: #555; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
      th, td { border: 1px solid #bbb; padding: 8px 10px; text-align: left; }
      th { background: #111; color: #fff; }
      td.num { text-align: center; }
      .footer { margin-top: 24px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 12px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="brand">X-Group Hospitality</div>
      <h1><%= title %></h1>
      <p class="sub"><%= subtitle %></p>
      <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total bookings</td><td class="num"><%= summary.total %></td></tr>
        <tr><td>Tentative / Confirmed / Completed</td><td class="num"><%= summary.tentative %> / <%= summary.confirmed %> / <%= summary.completed %></td></tr>
        <tr><td>Lunch guests (expected)</td><td class="num"><%= summary.lunchPax %> pax (<%= summary.lunch %> parties)</td></tr>
        <tr><td>Dinner guests (expected)</td><td class="num"><%= summary.dinnerPax %> pax (<%= summary.dinner %> parties)</td></tr>
        <tr><td>Actual pax served</td><td class="num"><%= summary.actualPax %></td></tr>
      </table>
      <p class="sub">Full branch breakdown and the date-matrix are in the attached PDF.</p>
      <div class="footer">Automated report — X-Group Feedback System. Do not reply.</div>
    </div>
  </body>
</html>`;

export interface BookingReportMailData {
  title: string;
  subtitle: string;
  summary: {
    total: number;
    tentative: number;
    confirmed: number;
    completed: number;
    lunch: number;
    dinner: number;
    lunchPax: number;
    dinnerPax: number;
    actualPax: number;
  };
}
