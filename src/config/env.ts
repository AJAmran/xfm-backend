import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

function required(key: string, fallback?: string): string {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export default {
  port: Number(process.env.PORT) || 5000,
  database_url: required("DATABASE_URL"),
  app_url: required("APP_URL", "http://localhost:3000"),
  jwt_access_secret: required("JWT_ACCESS_SECRET"),
  jwt_refresh_secret: required("JWT_REFRESH_SECRET"),
  jwt_access_expires_in: required("JWT_ACCESS_EXPIRES_IN", "15m"),
  jwt_refresh_expires_in: required("JWT_REFRESH_EXPIRES_IN", "7d"),
  salt_rounds: Number(process.env.SALT_ROUNDS) || 12,
  node_env: process.env.NODE_ENV || "development",
};
