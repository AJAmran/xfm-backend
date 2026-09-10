import nodemailer from "nodemailer";
import env from "../config/env";

/** Gmail SMTP transporter singleton (same style as b7 healthcare backend). */
export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: env.smtp_user,
    pass: env.smtp_password,
  },
});

/** False when SMTP credentials are missing — scheduled mails stay disabled. */
export function isMailConfigured(): boolean {
  return env.smtp_user !== "" && env.smtp_password !== "";
}
