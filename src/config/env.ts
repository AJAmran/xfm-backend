import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const envSchema = z.object({
  PORT: z.coerce.number().positive().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  SALT_ROUNDS: z.coerce.number().positive().default(12),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
  app_url: env.APP_URL,
  jwt_access_secret: env.JWT_ACCESS_SECRET,
  jwt_refresh_secret: env.JWT_REFRESH_SECRET,
  jwt_access_expires_in: env.JWT_ACCESS_EXPIRES_IN,
  jwt_refresh_expires_in: env.JWT_REFRESH_EXPIRES_IN,
  salt_rounds: env.SALT_ROUNDS,
  node_env: env.NODE_ENV,
};
