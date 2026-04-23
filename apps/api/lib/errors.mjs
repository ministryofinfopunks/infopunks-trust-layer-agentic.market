export class AppError extends Error {
  constructor({
    code,
    message,
    statusCode = 500,
    details = {},
    suggestedActions = [],
    traceId,
    cause
  }) {
    super(message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details && typeof details === "object" && !Array.isArray(details) ? details : {};
    this.suggestedActions = Array.isArray(suggestedActions) ? suggestedActions.filter(Boolean) : [];
    this.traceId = traceId ?? null;
  }
}

export function appError(input) {
  return new AppError(input);
}

export function validationError(issues) {
  return appError({
    code: "INVALID_REQUEST",
    message: "Request validation failed.",
    statusCode: 400,
    details: { issues },
    suggestedActions: ["fix_request_payload"]
  });
}

export function unauthorizedError() {
  return appError({
    code: "UNAUTHORIZED",
    message: "Missing or invalid API key.",
    statusCode: 401,
    suggestedActions: ["provide_valid_api_key"]
  });
}

export function forbiddenError(message = "API key is not authorized for this operation.", details = {}, suggestedActions = ["use_authorized_api_key"]) {
  return appError({
    code: "FORBIDDEN",
    message,
    statusCode: 403,
    details,
    suggestedActions
  });
}

export function rateLimitedError() {
  return appError({
    code: "RATE_LIMITED",
    message: "Rate limit exceeded.",
    statusCode: 429,
    suggestedActions: ["retry_later"]
  });
}

export function notFoundError(details = {}) {
  return appError({
    code: "NOT_FOUND",
    message: "Resource not found.",
    statusCode: 404,
    details,
    suggestedActions: ["check_resource_identifier"]
  });
}

export function routeNotFoundError(method, path) {
  return appError({
    code: "NOT_FOUND",
    message: "Route not found.",
    statusCode: 404,
    details: { method, path },
    suggestedActions: ["check_api_path"]
  });
}

export function methodNotAllowedError(method, path) {
  return appError({
    code: "METHOD_NOT_ALLOWED",
    message: "Method not allowed for route.",
    statusCode: 405,
    details: { method, path },
    suggestedActions: ["use_supported_method"]
  });
}

export function payloadTooLargeError(maxBytes) {
  return appError({
    code: "PAYLOAD_TOO_LARGE",
    message: "Request payload exceeds limit.",
    statusCode: 413,
    details: { max_bytes: maxBytes },
    suggestedActions: ["reduce_payload_size"]
  });
}

export function invalidJsonError(details = {}) {
  return appError({
    code: "INVALID_REQUEST",
    message: "Request body must be valid JSON.",
    statusCode: 400,
    details,
    suggestedActions: ["send_valid_json"]
  });
}

export function attachTraceId(error, traceId) {
  if (error instanceof AppError) {
    if (!error.traceId) {
      error.traceId = traceId;
    }
    return error;
  }
  return normalizeError(error, traceId);
}

export function normalizeError(error, traceId = null) {
  if (error instanceof AppError) {
    return attachTraceId(error, traceId);
  }
  if (error instanceof SyntaxError) {
    const normalized = invalidJsonError();
    normalized.traceId = traceId;
    return normalized;
  }
  const normalized = appError({
    code: error?.code ?? "TEMPORARY_UNAVAILABLE",
    message: error?.message ?? "Temporarily unavailable.",
    statusCode: Number.isInteger(error?.statusCode) && error.statusCode >= 400 ? error.statusCode : 500,
    details: error?.details ?? {},
    suggestedActions: error?.suggestedActions ?? [],
    traceId,
    cause: error
  });
  return normalized;
}

export function errorToResponse(error, traceId = null) {
  const normalized = normalizeError(error, traceId);
  return {
    statusCode: normalized.statusCode,
    body: {
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
        suggested_actions: normalized.suggestedActions,
        trace_id: normalized.traceId
      }
    }
  };
}
