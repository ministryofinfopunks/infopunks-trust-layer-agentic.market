#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

import { AdapterStateStore } from "../services/mcp-adapter/src/storage/state-store.mjs";

function parseArgs(argv) {
  const args = { limit: 50, db: null };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--limit" && argv[index + 1]) {
      args.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--db" && argv[index + 1]) {
      args.db = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function resolveDbPath(dbArg) {
  if (dbArg) {
    return path.resolve(dbArg);
  }
  if (process.env.MCP_ADAPTER_STATE_DB_PATH) {
    return path.resolve(process.env.MCP_ADAPTER_STATE_DB_PATH);
  }
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR, "mcp-adapter", "adapter-state.db");
  }
  const env = process.env.INFOPUNKS_ENVIRONMENT ?? "local";
  if (env === "local" || env === "test") {
    return path.resolve(process.cwd(), "services/mcp-adapter/.runtime/adapter-state.db");
  }
  return path.join(os.tmpdir(), "infopunks", "mcp-adapter", "adapter-state.db");
}

const { limit, db } = parseArgs(process.argv);
const dbPath = resolveDbPath(db);
const store = new AdapterStateStore({ dbPath });
const events = store.listWarRoomEvents(limit);

console.log(JSON.stringify({
  db_path: dbPath,
  count: events.length,
  events
}, null, 2));
