// Structured logging (Pino, JSON) per architecture Section 17.
//
// Both the API and worker processes import this and immediately bind
// `service: "api"` or `service: "worker"` (see src/app.ts and
// worker/worker.ts), so a single user action can be traced across both
// processes via a shared correlation ID (see middleware/requestLogger.ts
// for how the correlation ID is attached on the API side).

import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
});
