import { randomUUID } from "node:crypto";

export function createAdapterTraceId() {
  return `mcp_trc_${randomUUID().replace(/-/g, "")}`;
}
