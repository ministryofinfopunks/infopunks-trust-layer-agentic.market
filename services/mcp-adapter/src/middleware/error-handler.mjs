import { AdapterError, adapterErrorEnvelope, mapUpstreamError } from "../schemas/error-schema.mjs";
import { UpstreamError } from "../client/infopunks-api-client.mjs";

export function toMcpToolError(error, adapterTraceId, operation = null) {
  if (error instanceof UpstreamError) {
    const mapped = mapUpstreamError(error, adapterTraceId, operation);
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(mapped) }],
      structuredContent: mapped
    };
  }

  const envelope = adapterErrorEnvelope(error instanceof AdapterError ? error : error, adapterTraceId);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope
  };
}
