import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const envSchema = z.object({
  PORT: z.coerce.number().positive().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Optional manual override for SSL. Leave unset to auto-detect from
  // DATABASE_URL's `ssl-mode=REQUIRED` param (e.g. Aiven). Set explicitly
  // to "true"/"false" if a host needs it forced one way or the other
  // (e.g. shared hosting with no SSL support, or a host missing the query param).
  DATABASE_SSL: z
    .enum(["true", "false"])
    .optional(),
  APP_URL: z.string().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  SALT_ROUNDS: z.coerce.number().positive().default(12),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  REPORT_EXPORT_LIMIT: z.coerce.number().positive().default(5000),
  REPORT_FETCH_LIMIT: z.coerce.number().positive().default(1000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
  throw new Error(`Environment variable validation failed:\n  ${issues}`);
}

const env = parsed.data;

export default {
  port: env.PORT,
  database_url: env.DATABASE_URL,
  // undefined when unset, so prisma.ts can fall back to auto-detection
  database_ssl: env.DATABASE_SSL,
  app_url: env.APP_URL,
  jwt_access_secret: env.JWT_ACCESS_SECRET,
  jwt_refresh_secret: env.JWT_REFRESH_SECRET,
  jwt_access_expires_in: env.JWT_ACCESS_EXPIRES_IN,
  jwt_refresh_expires_in: env.JWT_REFRESH_EXPIRES_IN,
  salt_rounds: env.SALT_ROUNDS,
  node_env: env.NODE_ENV,
  report_export_limit: env.REPORT_EXPORT_LIMIT,
  report_fetch_limit: env.REPORT_FETCH_LIMIT,
};