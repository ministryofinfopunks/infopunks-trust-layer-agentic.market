import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAiPluginManifest } from "../config/ai-plugin.mjs";
import { buildBazaarDiscoveryDocument } from "../config/bazaar-discovery.mjs";
import { buildMarketplaceManifest } from "../config/marketplace-manifest.mjs";
import { findTool } from "../config/tool-registry.mjs";
import { createAdapterTraceId } from "../observability/tracing.mjs";
import { toMcpToolError } from "../middleware/error-handler.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
const ADAPTER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPENAPI_FILE = path.join(ADAPTER_ROOT, "..", "openapi.yaml");

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, statusCode, text, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
    ...extraHeaders
  });
  res.end(text);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function contentTypeIsJson(req) {
  const value = String(req.headers?.["content-type"] ?? "");
  return value.toLowerCase().includes("application/json");
}

function requireAdminToken(req, config) {
  if (!config.adminEndpointsRequireToken) {
    return true;
  }
  if (!config.adminToken) {
    return String(config.environment ?? "local") === "local";
  }
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return safeEqual(auth.slice(7).trim(), config.adminToken);
  }
  return safeEqual(req.headers["x-admin-token"], config.adminToken);
}

function verifyWebhookHmac({ req, rawBody, config }) {
  if (!config.settlementWebhookHmacSecret) {
    return true;
  }

  const timestampHeader = req.headers["x-webhook-timestamp"];
  const signatureHeader = req.headers["x-webhook-signature"];
  if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") {
    return false;
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (skew > config.settlementWebhookMaxSkewSeconds) {
    return false;
  }

  const payload = `${timestampHeader}.${rawBody}`;
  const expected = createHmac("sha256", config.settlementWebhookHmacSecret).update(payload).digest("hex");
  return safeEqual(signatureHeader, expected);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Payload too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return { raw: "", parsed: null };
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return { raw, parsed: JSON.parse(raw) };
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, payment-signature, x-payment"
  };
}

const PAYMENT_ERROR_CODES = new Set([
  "ENTITLEMENT_REQUIRED",
  "PAYMENT_VERIFICATION_FAILED",
  "PAYMENT_SESSION_EXPIRED",
  "PAYMENT_REPLAY_DETECTED"
]);

function safeBase64Encode(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function safeBase64Decode(value) {
  return Buffer.from(value, "base64").toString("utf8");
}

function normalizeNetworkToCaip2(network) {
  const normalized = String(network ?? "").trim().toLowerCase();
  if (!normalized) {
    return "eip155:84532";
  }
  if (normalized.includes(":")) {
    return normalized;
  }
  if (normalized === "base-sepolia") {
    return "eip155:84532";
  }
  if (normalized === "base") {
    return "eip155:84532";
  }
  return normalized;
}

function supportedNetworks(config) {
  return (config.x402SupportedNetworks ?? ["eip155:84532"]).map(normalizeNetworkToCaip2);
}

function resourceUrl(config, resourcePath) {
  const origin = config.publicUrl ?? `http://${config.host}:${config.port}`;
  return `${origin.replace(/\/$/, "")}${resourcePath}`;
}

function paymentRequiredEnvelope(config, toolDef, resourcePath) {
  const units = Number(toolDef?.pricing?.units ?? 0);
  const unitAmountAtomic = BigInt(config.x402PricePerUnitAtomic ?? "10000");
  const challengeAmount = (unitAmountAtomic * BigInt(Math.max(units, 1))).toString();
  const network = normalizeNetworkToCaip2((config.x402SupportedNetworks ?? [])[0] ?? "eip155:84532");
  const extra = {};
  if (config.x402Eip712Name) {
    extra.name = config.x402Eip712Name;
  }
  if (config.x402Eip712Version) {
    extra.version = config.x402Eip712Version;
  }

  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: resourceUrl(config, resourcePath),
      description: toolDef?.description ?? "Paid Infopunks endpoint",
      mimeType: "application/json"
    },
    accepts: [
      {
        scheme: config.x402PaymentScheme ?? "exact",
        network,
        amount: challengeAmount,
        asset: config.x402PaymentAssetAddress,
        payTo: config.x402PayTo,
        maxTimeoutSeconds: Number(config.x402PaymentTimeoutSeconds ?? 300),
        ...(Object.keys(extra).length > 0 ? { extra } : {})
      }
    ]
  };
}

function challengeHeaders(config, toolDef, resourcePath = "/trust-score") {
  const units = toolDef?.pricing?.units ?? 0;
  const rail = "x402";
  const discovery = `${config.publicUrl ?? `http://${config.host}:${config.port}`}/.well-known/x402-bazaar.json`;
  const paymentRequired = paymentRequiredEnvelope(config, toolDef, resourcePath);
  return {
    "x402-required": "true",
    "x402-payment-rail": rail,
    "x402-pricing-units": String(units),
    "x402-accepted-assets": (config.x402AcceptedAssets ?? ["USDC"]).join(","),
    "x402-supported-networks": supportedNetworks(config).join(","),
    "x402-discovery": discovery,
    "PAYMENT-REQUIRED": safeBase64Encode(JSON.stringify(paymentRequired)),
    "www-authenticate": `x402 realm="infopunks", units="${units}", rail="${rail}"`
  };
}

function decodePaymentHeader(paymentHeader) {
  if (typeof paymentHeader !== "string" || !paymentHeader.trim()) {
    return null;
  }
  try {
    return JSON.parse(safeBase64Decode(paymentHeader));
  } catch {
    return null;
  }
}

function extractPayerFromPayload(paymentPayload) {
  const from = paymentPayload?.payload?.authorization?.from;
  if (typeof from === "string" && from.trim()) {
    return from;
  }
  return null;
}

function extractNonceFromPayload(paymentPayload) {
  const nonce = paymentPayload?.payload?.authorization?.nonce;
  if (typeof nonce === "string" && nonce.trim()) {
    return nonce;
  }
  return null;
}

function paymentFromHeaders(headers) {
  const paymentHeader = headers?.["payment-signature"] ?? headers?.["x-payment"];
  const decodedPayload = decodePaymentHeader(paymentHeader);
  if (!decodedPayload) {
    return null;
  }
  const accepted = decodedPayload?.accepted ?? null;
  return {
    rail: "x402",
    payer: extractPayerFromPayload(decodedPayload),
    nonce: extractNonceFromPayload(decodedPayload),
    asset: accepted?.asset ?? null,
    network: accepted?.network ?? null,
    paymentPayload: decodedPayload,
    paymentRequirements: accepted
  };
}

function mergeHeaderPayment(body, headers) {
  const headerPayment = paymentFromHeaders(headers);
  if (!headerPayment) {
    return body;
  }
  if (body?.payment && typeof body.payment === "object") {
    return {
      ...body,
      payment: {
        ...headerPayment,
        ...body.payment
      }
    };
  }
  return {
    ...body,
    payment: headerPayment
  };
}

function attachHeaderPaymentToRpcRequest(request, headers) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return request;
  }
  if (request.method !== "tools/call") {
    return request;
  }
  const withPayment = mergeHeaderPayment(request.params?.arguments ?? {}, headers);
  return {
    ...request,
    params: {
      ...(request.params ?? {}),
      arguments: withPayment
    }
  };
}

function toNumeric(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toRiskLevel({ score, band }) {
  const normalizedBand = String(band ?? "").toLowerCase();
  if (normalizedBand === "safe" || normalizedBand === "green") {
    return "low";
  }
  if (normalizedBand === "watch" || normalizedBand === "yellow") {
    return "medium";
  }
  if (normalizedBand === "risk" || normalizedBand === "orange") {
    return "high";
  }
  if (normalizedBand === "critical" || normalizedBand === "red") {
    return "critical";
  }

  if (score >= 80) {
    return "low";
  }
  if (score >= 60) {
    return "medium";
  }
  if (score >= 40) {
    return "high";
  }
  return "critical";
}

function toPolicyRoute(decision) {
  const normalized = String(decision ?? "").toLowerCase();
  if (normalized.includes("block")) {
    return "block";
  }
  if (normalized.includes("quarantine")) {
    return "quarantine";
  }
  if (normalized.includes("degrade") || normalized.includes("validation")) {
    return "degrade";
  }
  return "allow";
}

function buildSignals(result = {}) {
  const signals = [];
  const reasons = Array.isArray(result.reason_codes) ? result.reason_codes : [];
  for (const reason of reasons.slice(0, 5)) {
    signals.push({
      name: `reason:${reason}`,
      value: true,
      weight: 0.2
    });
  }
  if (Array.isArray(result.recommended_validators)) {
    signals.push({
      name: "recommended_validators_count",
      value: result.recommended_validators.length,
      weight: 0.35
    });
  }
  signals.push({
    name: "trust_band",
    value: result.band ?? "unknown",
    weight: 0.45
  });
  return signals.slice(0, 8);
}

function normalizeTrustScoreRequest(body = {}) {
  const entityId = body.entity_id ?? body.subject_id ?? body.subjectId ?? body.agent_id ?? body.agentId ?? null;
  return {
    entity_id: entityId,
    context: body.context ?? {
      task_type: body.task_type ?? "general_assessment",
      domain: body.domain ?? "general",
      risk_level: body.risk_level ?? "medium"
    },
    policy_id: body.policy_id,
    policy_version: body.policy_version,
    include: body.include,
    candidate_validators: body.candidate_validators,
    response_mode: body.response_mode,
    payment: body.payment,
    spend_limit_units: body.spend_limit_units
  };
}

function toTrustScoreResponse(request, toolOutput) {
  const result = toolOutput?.result ?? {};
  const score = toNumeric(result.score, 0);
  const confidence = toNumeric(result.confidence, 0);
  const route = toPolicyRoute(result.decision);
  const reasonCodes = Array.isArray(result.reason_codes) ? result.reason_codes : [];
  const reason = reasonCodes.length > 0 ? reasonCodes.join(",") : String(result.decision ?? "policy_default");

  return {
    entity_id: String(request.entity_id),
    trust_score: Math.max(0, Math.min(100, Math.round(score))),
    risk_level: toRiskLevel({ score, band: result.band }),
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(4)))),
    last_updated: result.expires_at ?? new Date().toISOString(),
    signals: buildSignals(result),
    policy: {
      route,
      reason
    }
  };
}

function statusFromAdapterErrorCode(code, fallback = 500) {
  if (PAYMENT_ERROR_CODES.has(code)) {
    return code === "PAYMENT_REPLAY_DETECTED" ? 409 : 402;
  }
  if (code === "INVALID_INPUT") {
    return 400;
  }
  if (code === "UNKNOWN_SUBJECT" || code === "TRACE_UNAVAILABLE") {
    return 404;
  }
  if (code === "PASSPORT_REQUIRED" || code === "PASSPORT_REVOKED") {
    return 423;
  }
  if (code === "LOW_CONFIDENCE") {
    return 422;
  }
  if (code === "POLICY_BLOCKED") {
    return 409;
  }
  if (code === "UPSTREAM_UNAVAILABLE") {
    return 503;
  }
  return fallback;
}

export function createHttpTransport({ config, mcpServer, logger, metrics }) {
  async function executeRestTool({ toolName, args, req, res }) {
    const toolDef = findTool(toolName);
    if (!toolDef) {
      sendJson(res, 404, { error: { code: "INVALID_INPUT", message: `Unknown tool ${toolName}.` } }, corsHeaders());
      return;
    }

    const adapterTraceId = createAdapterTraceId();
    try {
      const output = await mcpServer.executeTool(
        toolDef,
        args,
        adapterTraceId,
        { headers: req.headers, ip: req.socket?.remoteAddress ?? null }
      );
      sendJson(res, 200, output, {
        ...corsHeaders(),
        "x402-discovery": `${config.publicUrl ?? `http://${config.host}:${config.port}`}/.well-known/x402-bazaar.json`
      });
    } catch (error) {
      const errorEnvelope = toMcpToolError(error, adapterTraceId, toolDef.operation).structuredContent;
      const code = errorEnvelope?.error?.code ?? "UPSTREAM_UNAVAILABLE";
      const statusCode = statusFromAdapterErrorCode(code, error?.status ?? 500);
      const extraHeaders = PAYMENT_ERROR_CODES.has(code) ? challengeHeaders(config, toolDef) : {};
      sendJson(res, statusCode, errorEnvelope, { ...corsHeaders(), ...extraHeaders });
    }
  }

  async function marketplaceReadiness() {
    const verifier = await mcpServer.entitlementService?.verifier?.readiness?.();
    const discoveryDoc = buildBazaarDiscoveryDocument(config);
    const toolCount = Array.isArray(discoveryDoc?.tools) ? discoveryDoc.tools.length : 0;
    const readiness = {
      public_url_configured: Boolean(config.publicUrl),
      facilitator_mode_enabled: config.x402VerifierMode === "facilitator",
      verifier_connected: Boolean(verifier?.connected),
      settlement_webhook_configured: Boolean(config.settlementWebhookHmacSecret || config.settlementWebhookSecret),
      admin_security_configured: Boolean(!config.adminEndpointsRequireToken || config.adminToken),
      entitlement_policy_ready: Boolean(
        config.entitlementTokenRequired
        && config.entitlementIssuer
        && config.entitlementAudience
      ),
      discovery_metadata_valid: toolCount > 0
    };
    return {
      signals: readiness,
      details: {
        verifier_mode: config.x402VerifierMode,
        verifier_reason: verifier?.reason ?? "unknown",
        public_url: config.publicUrl ?? null,
        discovery_tool_count: toolCount
      },
      ready_for_listing: Object.values(readiness).every(Boolean)
    };
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const method = String(req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    // Lightweight Render health check: no DB/upstream dependency.
    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" }, corsHeaders());
      return;
    }

    if (method === "GET" && url.pathname === "/healthz") {
      const healthy = await mcpServer.apiClient.health();
      const listing = await marketplaceReadiness();
      sendJson(
        res,
        healthy ? (listing.ready_for_listing ? 200 : 206) : 503,
        {
          ok: healthy,
          service: config.adapterName,
          version: config.adapterVersion,
          transport: "http",
          marketplace_readiness: listing
        },
        corsHeaders()
      );
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      sendJson(
        res,
        200,
        {
          ok: true,
          service: config.adapterName,
          version: config.adapterVersion,
          mcp_endpoint: "/mcp",
          public_url: config.publicUrl ?? null,
          discovery_metadata: "/.well-known/x402-bazaar.json",
          zero_api_keys_externally: true
        },
        corsHeaders()
      );
      return;
    }

    if (method === "POST" && url.pathname === "/trust-score") {
      if (!contentTypeIsJson(req)) {
        sendJson(res, 415, { error: "content_type_must_be_application_json" }, corsHeaders());
        return;
      }
      let bodyAndRaw;
      try {
        bodyAndRaw = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: "invalid_json", message: error?.message ?? "invalid_json" }, corsHeaders());
        return;
      }
      const body = mergeHeaderPayment(bodyAndRaw.parsed ?? {}, req.headers);
      const normalized = normalizeTrustScoreRequest(body);
      if (!normalized.entity_id) {
        sendJson(
          res,
          400,
          {
            error: {
              code: "INVALID_INPUT",
              message: "entity_id (or subject_id/agent_id) is required."
            }
          },
          corsHeaders()
        );
        return;
      }
      const toolDef = findTool("resolve_trust");
      const adapterTraceId = createAdapterTraceId();
      const args = {
        subject_id: normalized.entity_id,
        context: normalized.context,
        policy_id: normalized.policy_id,
        policy_version: normalized.policy_version,
        include: normalized.include,
        candidate_validators: normalized.candidate_validators,
        response_mode: normalized.response_mode,
        payment: normalized.payment,
        spend_limit_units: normalized.spend_limit_units
      };

      logger.info({
        event: "trust_score_request_received",
        adapter_trace_id: adapterTraceId,
        entity_id: normalized.entity_id,
        ip: req.socket?.remoteAddress ?? "unknown"
      });

      try {
        const output = await mcpServer.executeTool(
          toolDef,
          args,
          adapterTraceId,
          { headers: req.headers, ip: req.socket?.remoteAddress ?? null }
        );
        logger.info({
          event: "trust_score_payment_validated",
          adapter_trace_id: adapterTraceId,
          entity_id: normalized.entity_id,
          billed_units: output?.meta?.billed_units ?? 0,
          payment_receipt_id: output?.meta?.payment_receipt_id ?? null
        });

        const trustResponse = toTrustScoreResponse(normalized, output);
        sendJson(res, 200, trustResponse, {
          ...corsHeaders(),
          "x402-discovery": `${config.publicUrl ?? `http://${config.host}:${config.port}`}/.well-known/x402-bazaar.json`
        });
        logger.info({
          event: "trust_score_response_sent",
          adapter_trace_id: adapterTraceId,
          entity_id: normalized.entity_id,
          trust_score: trustResponse.trust_score,
          policy_route: trustResponse.policy.route
        });
      } catch (error) {
        const errorEnvelope = toMcpToolError(error, adapterTraceId, toolDef.operation).structuredContent;
        const code = errorEnvelope?.error?.code ?? "UPSTREAM_UNAVAILABLE";
        const statusCode = statusFromAdapterErrorCode(code, error?.status ?? 500);
        const extraHeaders = PAYMENT_ERROR_CODES.has(code) ? challengeHeaders(config, toolDef, "/trust-score") : {};

        if (PAYMENT_ERROR_CODES.has(code)) {
          logger.info({
            event: "trust_score_payment_required",
            adapter_trace_id: adapterTraceId,
            entity_id: normalized.entity_id,
            code
          });
        } else {
          logger.error({
            event: "trust_score_error",
            adapter_trace_id: adapterTraceId,
            entity_id: normalized.entity_id,
            code,
            message: errorEnvelope?.error?.message ?? "trust_score_route_failed"
          });
        }
        sendJson(res, statusCode, errorEnvelope, { ...corsHeaders(), ...extraHeaders });
      }
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/agent-reputation/")) {
      const subjectId = decodeURIComponent(url.pathname.slice("/agent-reputation/".length));
      if (!subjectId) {
        sendJson(
          res,
          400,
          { error: { code: "INVALID_INPUT", message: "Agent reputation path requires an id." } },
          corsHeaders()
        );
        return;
      }

      const adapterTraceId = createAdapterTraceId();
      try {
        const passport = await mcpServer.apiClient.getPassport(subjectId, adapterTraceId);
        const explanation = await mcpServer.apiClient
          .getTrustExplanation(subjectId, url.searchParams.get("context_hash"), adapterTraceId)
          .catch(() => null);
        sendJson(
          res,
          200,
          {
            result: {
              subject_id: subjectId,
              passport,
              trust_explanation: explanation
            },
            meta: {
              endpoint: "agent_reputation",
              adapter_trace_id: adapterTraceId
            }
          },
          corsHeaders()
        );
      } catch (error) {
        const mapped = toMcpToolError(error, adapterTraceId, "get_passport").structuredContent;
        const code = mapped?.error?.code ?? "UPSTREAM_UNAVAILABLE";
        sendJson(res, statusFromAdapterErrorCode(code, error?.status ?? 500), mapped, corsHeaders());
      }
      return;
    }

    if (method === "POST" && url.pathname === "/verify-evidence") {
      if (!contentTypeIsJson(req)) {
        sendJson(res, 415, { error: "content_type_must_be_application_json" }, corsHeaders());
        return;
      }
      let bodyAndRaw;
      try {
        bodyAndRaw = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: "invalid_json", message: error?.message ?? "invalid_json" }, corsHeaders());
        return;
      }
      const body = bodyAndRaw.parsed ?? {};
      const adapterTraceId = createAdapterTraceId();
      try {
        const accepted = await mcpServer.apiClient.recordEvidence(body, adapterTraceId);
        sendJson(
          res,
          202,
          {
            result: accepted,
            meta: {
              endpoint: "verify_evidence",
              adapter_trace_id: adapterTraceId
            }
          },
          corsHeaders()
        );
      } catch (error) {
        const mapped = toMcpToolError(error, adapterTraceId, "verify_evidence").structuredContent;
        const code = mapped?.error?.code ?? "UPSTREAM_UNAVAILABLE";
        sendJson(res, statusFromAdapterErrorCode(code, error?.status ?? 500), mapped, corsHeaders());
      }
      return;
    }

    if (method === "GET" && (url.pathname === "/.well-known/x402-bazaar.json" || url.pathname === "/bazaar/discovery")) {
      sendJson(res, 200, buildBazaarDiscoveryDocument(config), corsHeaders());
      return;
    }

    if (method === "GET" && url.pathname === "/marketplace/readiness") {
      sendJson(res, 200, await marketplaceReadiness(), corsHeaders());
      return;
    }

    if (method === "GET" && url.pathname === "/.well-known/ai-plugin.json") {
      sendJson(res, 200, buildAiPluginManifest(config), corsHeaders());
      return;
    }

    if (method === "GET" && (url.pathname === "/.well-known/agentic-marketplace.json" || url.pathname === "/marketplace/manifest")) {
      sendJson(res, 200, buildMarketplaceManifest(config), corsHeaders());
      return;
    }

    if (method === "GET" && url.pathname === "/openapi.yaml") {
      try {
        const spec = readFileSync(OPENAPI_FILE, "utf8");
        sendText(res, 200, spec, { ...corsHeaders(), "content-type": "application/yaml; charset=utf-8" });
      } catch {
        sendJson(res, 404, { ok: false, error: "openapi_not_found" }, corsHeaders());
      }
      return;
    }

    if (method === "GET" && url.pathname === "/metrics") {
      if (!config.metricsPublic && !requireAdminToken(req, config)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" }, corsHeaders());
        return;
      }
      sendJson(res, 200, { counters: metrics.snapshot() }, corsHeaders());
      return;
    }

    if (method === "POST" && url.pathname === "/mcp") {
      if (!contentTypeIsJson(req)) {
        sendJson(res, 415, { error: "content_type_must_be_application_json" }, corsHeaders());
        return;
      }

      let bodyAndRaw;
      try {
        bodyAndRaw = await readJsonBody(req);
      } catch (error) {
        sendJson(
          res,
          400,
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: error?.message ?? "Parse error" }
          },
          corsHeaders()
        );
        return;
      }
      const body = bodyAndRaw.parsed;

      if (Array.isArray(body)) {
        if (body.length > config.maxBatchRequests) {
          sendJson(
            res,
            400,
            {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32600,
                message: `Batch request exceeds max size (${config.maxBatchRequests}).`
              }
            },
            corsHeaders()
          );
          return;
        }
        const responses = [];
        for (const request of body) {
          try {
            const normalizedRequest = attachHeaderPaymentToRpcRequest(request, req.headers);
            const response = await mcpServer.handleRequest(normalizedRequest, { headers: req.headers, ip: req.socket?.remoteAddress ?? null });
            if (response) {
              responses.push(response);
            }
          } catch (error) {
            responses.push({
              jsonrpc: "2.0",
              id: request?.id ?? null,
              error: { code: -32000, message: error?.message ?? "Unhandled server error" }
            });
          }
        }
        const firstPaymentError = responses.find((item) => PAYMENT_ERROR_CODES.has(item?.result?.structuredContent?.error?.code));
        const firstPaidRequest = body.find((request) => request?.method === "tools/call");
        const toolDef = findTool(firstPaidRequest?.params?.name);
        sendJson(res, firstPaymentError ? 402 : 200, responses, {
          ...corsHeaders(),
          ...(firstPaymentError ? challengeHeaders(config, toolDef, "/mcp") : {}),
          "x402-discovery": `${config.publicUrl ?? `http://${config.host}:${config.port}`}/.well-known/x402-bazaar.json`
        });
      } else {
        try {
          const normalizedRequest = attachHeaderPaymentToRpcRequest(body, req.headers);
          const response = await mcpServer.handleRequest(normalizedRequest, { headers: req.headers, ip: req.socket?.remoteAddress ?? null });
          if (!response) {
            res.writeHead(204, corsHeaders());
            res.end();
            return;
          }
          const code = response?.result?.structuredContent?.error?.code;
          const isPaymentError = PAYMENT_ERROR_CODES.has(code);
          const toolDef = findTool(normalizedRequest?.params?.name);
          sendJson(res, isPaymentError ? 402 : 200, response, {
            ...corsHeaders(),
            ...(isPaymentError ? challengeHeaders(config, toolDef, "/mcp") : {}),
            "x402-discovery": `${config.publicUrl ?? `http://${config.host}:${config.port}`}/.well-known/x402-bazaar.json`
          });
        } catch (error) {
          sendJson(
            res,
            500,
            {
              jsonrpc: "2.0",
              id: body?.id ?? null,
              error: { code: -32000, message: error?.message ?? "Unhandled server error" }
            },
            corsHeaders()
          );
        }
      }
      logger.info({
        event: "http_request",
        method,
        path: url.pathname,
        status_code: res.statusCode,
        duration_ms: Date.now() - started
      });
      return;
    }

    if (method === "POST" && url.pathname === "/x402/settlement/webhook") {
      if (!contentTypeIsJson(req)) {
        sendJson(res, 415, { ok: false, error: "content_type_must_be_application_json" }, corsHeaders());
        return;
      }

      let bodyAndRaw;
      try {
        bodyAndRaw = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error?.message ?? "invalid_json" }, corsHeaders());
        return;
      }
      const body = bodyAndRaw.parsed;

      if (!verifyWebhookHmac({ req, rawBody: bodyAndRaw.raw, config })) {
        sendJson(res, 401, { ok: false, error: "invalid_signature" }, corsHeaders());
        return;
      }
      if (!config.settlementWebhookHmacSecret && config.settlementWebhookSecret) {
        const token = req.headers["x-webhook-secret"];
        if (!safeEqual(token, config.settlementWebhookSecret)) {
          sendJson(res, 401, { ok: false, error: "unauthorized" }, corsHeaders());
          return;
        }
      }

      const settled = await mcpServer.reconciliationService.applySettlementEvent(body ?? {});
      sendJson(res, settled.ok ? 200 : 404, settled, corsHeaders());
      return;
    }

    if (method === "POST" && url.pathname === "/x402/reconcile") {
      if (!requireAdminToken(req, config)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" }, corsHeaders());
        return;
      }
      const output = await mcpServer.reconciliationService.reconcileOnce({ adapterTraceId: null });
      sendJson(res, 200, output, corsHeaders());
      return;
    }

    sendText(res, 404, "Not found", corsHeaders());
  });

  return {
    listen() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          logger.info({
            event: "http_server_started",
            host: config.host,
            port: config.port,
            mcp_endpoint: `${config.publicUrl ?? `http://${config.host}:${config.port}`}/mcp`
          });
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

export const __testOnly = {
  safeEqual,
  contentTypeIsJson,
  requireAdminToken,
  verifyWebhookHmac,
  statusFromAdapterErrorCode,
  challengeHeaders,
  normalizeTrustScoreRequest,
  toTrustScoreResponse,
  toPolicyRoute,
  toRiskLevel
};
