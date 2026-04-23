import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TrustPlatform } from "./lib/platform.mjs";
import { createApiServer } from "./lib/http.mjs";
import { buildRoutes } from "./lib/routes.mjs";
import { jsonLog } from "./lib/utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const warRoomRoot = path.resolve(__dirname, "../war-room");
const defaultDbPath = path.resolve(__dirname, "../../data/infopunks.db");
const platform = new TrustPlatform({
  dbPath: process.env.INFOPUNKS_DB_PATH || defaultDbPath,
  apiKey: process.env.INFOPUNKS_API_KEY || "dev-infopunks-key"
});

const server = http.createServer(
  createApiServer({
    platform,
    routes: buildRoutes({ platform, warRoomRoot })
  })
);

const port = Number(process.env.PORT || 4010);
let shuttingDown = false;

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  jsonLog({
    timestamp: new Date().toISOString(),
    service: "infopunks.api",
    level: exitCode === 0 ? "info" : "error",
    trace_id: null,
    subject_id: null,
    request_id: null,
    route_id: "server.shutdown",
    event_type: "server.shutdown",
    policy_version: "policy_default@1.0.0",
    engine_version: "trust-engine@1.0.0",
    status_code: exitCode === 0 ? 200 : 500,
    error_code: null,
    signal
  });
  server.close(() => {
    process.exit(exitCode);
  });
  setTimeout(() => {
    process.exit(exitCode);
  }, 5000).unref?.();
}

server.on("error", (error) => {
  jsonLog({
    timestamp: new Date().toISOString(),
    service: "infopunks.api",
    level: "error",
    trace_id: null,
    subject_id: null,
    request_id: null,
    route_id: "server.error",
    event_type: "server.error",
    policy_version: "policy_default@1.0.0",
    engine_version: "trust-engine@1.0.0",
    status_code: 500,
    error_code: error?.code ?? "SERVER_ERROR",
    message: error?.message ?? "Server error."
  });
  process.exitCode = 1;
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("uncaughtException", (error) => {
  jsonLog({
    timestamp: new Date().toISOString(),
    service: "infopunks.api",
    level: "error",
    trace_id: null,
    subject_id: null,
    request_id: null,
    route_id: "process.uncaughtException",
    event_type: "process.uncaughtException",
    policy_version: "policy_default@1.0.0",
    engine_version: "trust-engine@1.0.0",
    status_code: 500,
    error_code: error?.code ?? "UNCAUGHT_EXCEPTION",
    message: error?.message ?? "Uncaught exception."
  });
  shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (reason) => {
  jsonLog({
    timestamp: new Date().toISOString(),
    service: "infopunks.api",
    level: "error",
    trace_id: null,
    subject_id: null,
    request_id: null,
    route_id: "process.unhandledRejection",
    event_type: "process.unhandledRejection",
    policy_version: "policy_default@1.0.0",
    engine_version: "trust-engine@1.0.0",
    status_code: 500,
    error_code: "UNHANDLED_REJECTION",
    message: reason instanceof Error ? reason.message : "Unhandled promise rejection."
  });
  shutdown("unhandledRejection", 1);
});

server.listen(port, () => {
  jsonLog({
    timestamp: new Date().toISOString(),
    service: "infopunks.api",
    level: "info",
    trace_id: null,
    subject_id: null,
    request_id: null,
    route_id: "server.started",
    event_type: "server.started",
    policy_version: "policy_default@1.0.0",
    engine_version: "trust-engine@1.0.0",
    status_code: 200,
    error_code: null,
    port
  });
});
