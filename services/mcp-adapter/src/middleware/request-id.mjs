import { createAdapterTraceId } from "../observability/tracing.mjs";

const TRACE_ID_PATTERN = /^mcp_trc_[a-zA-Z0-9_-]{8,96}$/;

export function ensureTraceId(request) {
  const incoming = request?.params?.adapter_trace_id;
  if (typeof incoming === "string" && TRACE_ID_PATTERN.test(incoming)) {
    return incoming;
  }
  return createAdapterTraceId();
}
