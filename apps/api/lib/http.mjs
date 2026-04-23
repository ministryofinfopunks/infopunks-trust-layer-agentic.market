import fs from "node:fs";
import { invalidJsonError, methodNotAllowedError, normalizeError, payloadTooLargeError, routeNotFoundError, rateLimitedError } from "./errors.mjs";
import { makeId, parseAuth, sendJson, sendText, jsonLog } from "./utils.mjs";
import { validateOrThrow } from "./validation.mjs";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const JSON_CONTENT_TYPE_RE = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i;

function compilePath(pattern) {
  const parts = pattern.split("/").filter(Boolean);
  return {
    pattern,
    parts
  };
}

function matchCompiledPath(compiled, pathname) {
  const actualParts = pathname.split("/").filter(Boolean);
  if (compiled.parts.length !== actualParts.length) {
    return null;
  }
  const params = {};
  for (let index = 0; index < compiled.parts.length; index += 1) {
    const expected = compiled.parts[index];
    const actual = actualParts[index];
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
      continue;
    }
    if (expected !== actual) {
      return null;
    }
  }
  return params;
}

async function readJsonBody(req) {
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw payloadTooLargeError(MAX_JSON_BODY_BYTES);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw payloadTooLargeError(MAX_JSON_BODY_BYTES);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const contentType = req.headers["content-type"];
  if (contentType && !JSON_CONTENT_TYPE_RE.test(contentType)) {
    throw invalidJsonError({
      expected_content_type: "application/json",
      received_content_type: contentType
    });
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalidJsonError({
      expected_content_type: "application/json",
      received_content_type: contentType ?? null
    });
  }
}

function serveFile(filePath, contentType) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return {
        kind: "text",
        statusCode: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        },
        text: "Not found."
      };
    }
    return {
      kind: "text",
      statusCode: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store"
      },
      text: fs.readFileSync(filePath, "utf8")
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return {
        kind: "text",
        statusCode: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        },
        text: "Not found."
      };
    }
    throw error;
  }
}

function findRoute(routes, method, pathname) {
  const normalizedMethod = String(method ?? "GET").toUpperCase();
  let samePathDifferentMethod = false;
  for (const route of routes) {
    const params = matchCompiledPath(route.compiledPath, pathname);
    if (!params) {
      continue;
    }
    if (route.method !== normalizedMethod) {
      samePathDifferentMethod = true;
      continue;
    }
    return { route, params };
  }
  if (samePathDifferentMethod) {
    throw methodNotAllowedError(method, pathname);
  }
  throw routeNotFoundError(method, pathname);
}

function sendResult(res, result) {
  if (result.kind === "stream") {
    result.start(res);
    return;
  }
  if (result.kind === "text") {
    sendText(res, result.statusCode, result.text, result.headers);
    return;
  }
  sendJson(res, result.statusCode, result.body, result.headers);
}

export function defineRoute(definition) {
  return {
    ...definition,
    compiledPath: compilePath(definition.path)
  };
}

export function createApiServer({ platform, routes }) {
  return async function handleRequest(req, res) {
    const started = Date.now();
    const requestId = makeId("req").toLowerCase();
    let url;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch (error) {
      const normalized = normalizeError({
        code: "INVALID_REQUEST",
        message: "Request URL is invalid.",
        statusCode: 400,
        details: { url: req.url ?? null },
        suggestedActions: ["send_valid_request_url"],
        cause: error
      }, requestId);
      sendJson(res, normalized.statusCode, platform.decorateResponse({
        routeId: "invalid_request",
        authContext: null,
        routeRateLimit: { bucket: "read" },
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
      }), {
        "x-request-id": requestId
      });
      platform.recordHttpObservation({
        routeId: "invalid_request",
        statusCode: normalized.statusCode,
        errorCode: normalized.code,
        durationMs: Date.now() - started
      });
      jsonLog({
        timestamp: new Date().toISOString(),
        service: "infopunks.api",
        level: "error",
        trace_id: requestId,
        subject_id: req.headers["x-subject-id"] ?? null,
        caller_id: null,
        api_key_id: null,
        auth_environment: null,
        granted_scopes: [],
        request_id: requestId,
        route_id: "invalid_request",
        event_type: "invalid_request",
        policy_version: "policy_default@1.0.0",
        engine_version: "trust-engine@1.0.0",
        status_code: normalized.statusCode,
        error_code: normalized.code,
        duration_ms: Date.now() - started
      });
      return;
    }
    const method = String(req.method ?? "GET").toUpperCase();
    let routeId = "unmatched";
    let statusCode = 500;
    let errorCode = null;
    let authContext = null;

    try {
      const match = findRoute(routes, method, url.pathname);
      routeId = match.route.id;
      const route = match.route;
      const token = parseAuth(req);

      if (route.auth) {
        authContext = platform.authenticate(token, route.auth);
        if (!platform.enforceRateLimit(authContext, route.rateLimit)) {
          throw rateLimitedError();
        }
      }

      let body = undefined;
      if (route.bodySchema) {
        body = validateOrThrow(route.bodySchema, await readJsonBody(req));
      }

      const result = await route.handler({
        req,
        res,
        url,
        params: match.params,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
        requestId,
        authContext,
        serveFile
      });

      statusCode = result.statusCode;
      if (!result.kind || result.kind === "json" || result.body) {
        result.body = platform.decorateResponse({
          routeId,
          body: result.body,
          authContext,
          routeRateLimit: route.rateLimit,
          statusCode
        });
      }
      result.headers = {
        ...(result.headers ?? {}),
        "x-request-id": requestId
      };
      sendResult(res, result);
    } catch (error) {
      const normalized = normalizeError(error, requestId);
      statusCode = normalized.statusCode;
      errorCode = normalized.code;
      sendJson(res, normalized.statusCode, platform.decorateResponse({
        routeId,
        authContext,
        routeRateLimit: { bucket: "read" },
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
      }), {
        "x-request-id": requestId
      });
    } finally {
      const durationMs = Date.now() - started;
      platform.recordHttpObservation({
        routeId,
        statusCode,
        errorCode,
        durationMs
      });
      jsonLog({
        timestamp: new Date().toISOString(),
        service: "infopunks.api",
        level: statusCode >= 500 ? "error" : "info",
        trace_id: requestId,
        subject_id: req.headers["x-subject-id"] ?? null,
        caller_id: authContext?.caller_id ?? null,
        api_key_id: authContext?.key_id ?? null,
        auth_environment: authContext?.environment ?? null,
        granted_scopes: authContext?.scopes ?? [],
        request_id: requestId,
        route_id: routeId,
        event_type: url.pathname,
        policy_version: "policy_default@1.0.0",
        engine_version: "trust-engine@1.0.0",
        status_code: statusCode,
        error_code: errorCode,
        duration_ms: durationMs
      });
    }
  };
}
