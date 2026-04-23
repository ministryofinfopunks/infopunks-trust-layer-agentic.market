export class AdapterError extends Error {
  constructor(code, message, details = {}, retryable = false, status = 500) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    this.status = status;
  }
}

export function makeAdapterError(code, message, details = {}, retryable = false, status = 500) {
  return new AdapterError(code, message, details, retryable, status);
}

const DEFAULT_ERROR_MAP = {
  INVALID_REQUEST: "INVALID_INPUT",
  VALIDATION_ERROR: "INVALID_INPUT",
  NOT_FOUND: "UNKNOWN_SUBJECT",
  TRACE_UNAVAILABLE: "TRACE_UNAVAILABLE",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  POLICY_BLOCKED: "POLICY_BLOCKED",
  TEMPORARY_UNAVAILABLE: "UPSTREAM_UNAVAILABLE"
};

export function mapUpstreamError(error, adapterTraceId, operation = null) {
  const upstreamCode = error?.code ?? error?.body?.error?.code ?? "UPSTREAM_UNAVAILABLE";
  const status = Number(error?.status ?? 0);
  let mappedCode = DEFAULT_ERROR_MAP[upstreamCode] ?? "UPSTREAM_UNAVAILABLE";

  if (status === 404 && operation === "get_trace_replay") {
    mappedCode = "TRACE_UNAVAILABLE";
  } else if (status === 404 && operation === "get_prompt_pack") {
    mappedCode = "INVALID_INPUT";
  } else if (status === 404) {
    mappedCode = "UNKNOWN_SUBJECT";
  } else if (status === 400) {
    mappedCode = "INVALID_INPUT";
  } else if (status === 422) {
    mappedCode = "LOW_CONFIDENCE";
  } else if (status === 423) {
    mappedCode = upstreamCode === "PASSPORT_REVOKED" ? "PASSPORT_REVOKED" : "PASSPORT_REQUIRED";
  } else if (status >= 500) {
    mappedCode = "UPSTREAM_UNAVAILABLE";
  }
  const upstreamMessage = error?.body?.error?.message ?? error?.message ?? "Upstream call failed.";
  const message = String(upstreamMessage).slice(0, 240);
  return {
    error: {
      code: mappedCode,
      message,
      details: {
        operation,
        upstream_code: upstreamCode,
        upstream_status: status || null
      },
      retryable: mappedCode === "UPSTREAM_UNAVAILABLE",
      adapter_trace_id: adapterTraceId
    }
  };
}

export function adapterErrorEnvelope(error, adapterTraceId) {
  const err = error instanceof AdapterError
    ? error
    : new AdapterError("UPSTREAM_UNAVAILABLE", error?.message ?? "Unhandled adapter error.", {}, true, 500);

  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details ?? {},
      retryable: Boolean(err.retryable),
      adapter_trace_id: adapterTraceId
    }
  };
}
