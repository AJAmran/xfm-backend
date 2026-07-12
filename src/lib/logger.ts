import pino from "pino";
import env from "../config/env";

export const logger = pino({
  level: env.node_env === "production" ? "info" : "debug",
  ...(env.node_env !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss.l" },
    },
  }),
  redact: ["req.headers.authorization", "req.headers.cookie", "body.password"],
});
