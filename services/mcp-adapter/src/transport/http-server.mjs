import http from "node:http";
import { randomUUID } from "node:crypto";
import { findTool } from "../config/tool-registry.mjs";
import { resolveExactEvmTokenMetadata } from "../config/x402-token-metadata.mjs";
import { createAdapterTraceId } from "../observability/tracing.mjs";
import { toMcpToolError } from "../middleware/error-handler.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
const RESOLVE_TRUST_BAZAAR_DESCRIPTION = "Infopunks Trust Layer resolves real-time trust scores and routing decisions for AI agents, executors, wallets, and services. It returns trust_score, policy status, route decision, evidence freshness, and machine-readable risk context.";
const RESOLVE_TRUST_BAZAAR_TAGS = ["trust", "reputation", "routing", "agent-security", "x402", "ai-agents", "risk", "coordination"];
const RESOLVE_TRUST_BAZAAR_INPUT_EXAMPLE = {
  subject_id: "agent_public_paid_proof",
  context: {
    action: "execute_task",
    domain: "agentic_market",
    capital_at_risk_usd: 1000
  }
};
const RESOLVE_TRUST_BAZAAR_OUTPUT_EXAMPLE = {
  subject_id: "agent_public_paid_proof",
  trust_score: 40,
  risk_level: "medium",
  route: "allow",
  status: "allow"
};
const RESOLVE_TRUST_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    subject_id: { type: "string" },
    trust_score: { type: "number" },
    risk_level: { type: "string" },
    route: { type: "string" },
    status: { type: "string" }
  },
  required: ["subject_id", "trust_score", "route"]
};
const RESOLVE_TRUST_BAZAAR_EXTENSION = {
  info: {
    input: {
      type: "http",
      method: "POST",
      bodyType: "json",
      body: RESOLVE_TRUST_BAZAAR_INPUT_EXAMPLE
    },
    output: {
      type: "json",
      example: RESOLVE_TRUST_BAZAAR_OUTPUT_EXAMPLE
    },
    tags: RESOLVE_TRUST_BAZAAR_TAGS,
    category: "infrastructure"
  },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      input: {
        type: "object",
        properties: {
          type: { type: "string", const: "http" },
          method: { type: "string", enum: ["POST"] },
          bodyType: { type: "string", enum: ["json"] },
          body: {
            type: "object",
            properties: {
              subject_id: { type: "string" },
              context: { type: "object" }
            },
            required: ["subject_id"],
            additionalProperties: false
          }
        },
        required: ["type", "method", "bodyType", "body"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["json"] },
          example: RESOLVE_TRUST_RESPONSE_SCHEMA
        },
        required: ["example"],
        additionalProperties: false
      },
      tags: {
        type: "array",
        items: { type: "string" }
      },
      category: { type: "string" }
    },
    required: ["input"],
    additionalProperties: false
  }
};

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

function contentTypeIsJson(req) {
  const value = String(req.headers?.["content-type"] ?? "");
  return value.toLowerCase().includes("application/json");
}

function hasRequestBody(req) {
  const contentLength = req.headers?.["content-length"];
  if (contentLength != null && Number(contentLength) > 0) {
    return true;
  }
  return Boolean(req.headers?.["transfer-encoding"]);
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
    return "eip155:8453";
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

function routeOutputSchema(resourcePath, toolDef) {
  if (resourcePath === "/v1/resolve-trust") {
    return RESOLVE_TRUST_RESPONSE_SCHEMA;
  }
  return toolDef?.outputSchema ?? undefined;
}

function routeDescription(resourcePath, toolDef) {
  return resourcePath === "/v1/resolve-trust"
    ? RESOLVE_TRUST_BAZAAR_DESCRIPTION
    : (toolDef?.description ?? "Paid Infopunks endpoint");
}

function routeExtensions(resourcePath) {
  if (resourcePath === "/v1/resolve-trust") {
    return { bazaar: RESOLVE_TRUST_BAZAAR_EXTENSION };
  }
  return {};
}

function routeResourceMetadata(config, toolDef, resourcePath) {
  const url = resourceUrl(config, resourcePath);
  return {
    resource: url,
    url,
    description: routeDescription(resourcePath, toolDef),
    mimeType: "application/json",
    inputSchema: toolDef?.inputSchema ?? undefined,
    outputSchema: routeOutputSchema(resourcePath, toolDef),
    extensions: routeExtensions(resourcePath)
  };
}

function validateJsonSchema(value, schema, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") {
    return errors;
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push(`${path} should equal ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} should be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`);
    return errors;
  }

  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} should be object`);
      return errors;
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.hasOwn(value, key)) {
        errors.push(`${path}.${key} is required`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validateJsonSchema(value[key], childSchema, `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }
    return errors;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path} should be array`);
      return errors;
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`));
      });
    }
    return errors;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path} should be string`);
    }
    return errors;
  }

  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${path} should be number`);
    }
    return errors;
  }

  if (schema.type === "integer") {
    if (!Number.isInteger(value)) {
      errors.push(`${path} should be integer`);
    }
    return errors;
  }

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`${path} should be boolean`);
    }
  }

  return errors;
}

function paymentRequiredEnvelope(config, toolDef, resourcePath) {
  const units = Number(toolDef?.pricing?.units ?? 0);
  const unitAmountAtomic = BigInt(config.x402PricePerUnitAtomic ?? "10000");
  const challengeAmount = (unitAmountAtomic * BigInt(Math.max(units, 1))).toString();
  const network = normalizeNetworkToCaip2((config.x402SupportedNetworks ?? [])[0] ?? "eip155:84532");
  const tokenMetadata = resolveExactEvmTokenMetadata({
    network,
    assetAddress: config.x402PaymentAssetAddress,
    fallbackName: config.x402Eip712Name,
    fallbackVersion: config.x402Eip712Version
  });
  const facilitatorProvider = String(config.x402FacilitatorProvider ?? "openfacilitator").trim().toLowerCase();
  const preferredSymbol = String((config.x402AcceptedAssets ?? [])[0] ?? "").trim().toUpperCase();
  const configuredEip712Name = String(config.x402Eip712Name ?? "").trim();
  const configuredEip712Version = String(config.x402Eip712Version ?? "").trim();
  const extra = {};
  if (facilitatorProvider === "cdp") {
    if (configuredEip712Name) {
      extra.name = configuredEip712Name;
    }
    if (configuredEip712Version) {
      extra.version = configuredEip712Version;
    }
    if (preferredSymbol) {
      extra.symbol = preferredSymbol;
    } else if (tokenMetadata.symbol) {
      extra.symbol = tokenMetadata.symbol;
    }
  } else {
    if (tokenMetadata.name) {
      extra.name = tokenMetadata.name;
    }
    if (tokenMetadata.version) {
      extra.version = tokenMetadata.version;
    }
    if (tokenMetadata.symbol) {
      extra.symbol = tokenMetadata.symbol;
    }
  }

  return {
    x402Version: 2,
    error: "Payment required",
    resource: routeResourceMetadata(config, toolDef, resourcePath),
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

function challengeHeaders(config, toolDef, resourcePath = "/v1/resolve-trust") {
  const units = toolDef?.pricing?.units ?? 0;
  const rail = "x402";
  const discovery = `${config.publicUrl ?? `http://${config.host}:${config.port}`}/.well-known/infopunks-trust-layer.json`;
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

function displayPrice(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith("$") ? normalized : `$${normalized}`;
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

function paymentFromHeaders(headers, facilitatorProvider = "openfacilitator") {
  const paymentSignatureHeader = headers?.["payment-signature"];
  const legacyPaymentHeader = facilitatorProvider === "cdp" ? null : headers?.["x-payment"];
  const paymentHeader = paymentSignatureHeader ?? legacyPaymentHeader;
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

function hasBodyPayment(payment) {
  if (!payment || typeof payment !== "object") {
    return false;
  }
  return Boolean(
    payment.paymentPayload
    || payment.paymentRequirements
    || payment.rail
    || payment.payer
    || payment.nonce
    || payment.proof
    || payment.proof_id
    || payment.reference
    || payment.units_authorized
  );
}

function mergeHeaderPayment(body, headers, facilitatorProvider = "openfacilitator") {
  const headerPayment = paymentFromHeaders(headers, facilitatorProvider);
  const idempotencyKey = headers?.["idempotency-key"] ?? headers?.["x-idempotency-key"] ?? null;
  const requestTimestamp = headers?.["x-request-timestamp"] ?? null;
  const nonce = headers?.["x-payment-nonce"] ?? null;
  if (!headerPayment) {
    if (!body || typeof body !== "object") {
      return body;
    }
    if (!body.payment || typeof body.payment !== "object") {
      return body;
    }
    return {
      ...body,
      payment: {
        ...body.payment,
        ...(typeof idempotencyKey === "string" && idempotencyKey.trim() ? { idempotency_key: idempotencyKey.trim() } : {}),
        ...(typeof requestTimestamp === "string" && requestTimestamp.trim() ? { request_timestamp: requestTimestamp.trim() } : {}),
        ...(typeof nonce === "string" && nonce.trim() ? { nonce: nonce.trim() } : {})
      }
    };
  }
  if (body?.payment && typeof body.payment === "object") {
    return {
      ...body,
      payment: {
        ...headerPayment,
        ...body.payment,
        ...(typeof idempotencyKey === "string" && idempotencyKey.trim() ? { idempotency_key: idempotencyKey.trim() } : {}),
        ...(typeof requestTimestamp === "string" && requestTimestamp.trim() ? { request_timestamp: requestTimestamp.trim() } : {}),
        ...(typeof nonce === "string" && nonce.trim() ? { nonce: nonce.trim() } : {})
      }
    };
  }
  return {
    ...body,
    payment: {
      ...headerPayment,
      ...(typeof idempotencyKey === "string" && idempotencyKey.trim() ? { idempotency_key: idempotencyKey.trim() } : {}),
      ...(typeof requestTimestamp === "string" && requestTimestamp.trim() ? { request_timestamp: requestTimestamp.trim() } : {}),
      ...(typeof nonce === "string" && nonce.trim() ? { nonce: nonce.trim() } : {})
    }
  };
}

function attachHeaderPaymentToRpcRequest(request, headers, facilitatorProvider = "openfacilitator") {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return request;
  }
  if (request.method !== "tools/call") {
    return request;
  }
  const withPayment = mergeHeaderPayment(request.params?.arguments ?? {}, headers, facilitatorProvider);
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
  if (result.trust_state || result.trustState) {
    signals.push({
      name: "trust_state",
      value: result.trust_state ?? result.trustState,
      weight: 0.5
    });
  }
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
  const vector = (result.trust_vector ?? result.trustVector) ?? {};
  const score = toNumeric(result.score, toNumeric(result.trust_score, toNumeric(vector.overallTrust, 0)));
  const confidence = toNumeric(result.confidence, 0);
  const route = toPolicyRoute(result.decision);
  const reasonCodes = Array.isArray(result.reason_codes) ? result.reason_codes : [];
  const reason = reasonCodes.length > 0
    ? reasonCodes.join(",")
    : String(result.reason ?? result.decision ?? "policy_default");
  const policy = result.trust_policy ?? result.policy ?? null;
  const evidence = result.trust_evidence ?? result.evidence ?? null;
  const agenticMarket = result.agentic_market ?? result.agenticMarket ?? null;
  const mode = typeof result.mode === "string" && result.mode.trim()
    ? result.mode.trim()
    : (route === "allow" ? "verified" : "degraded");

  return {
    entity_id: String(request.entity_id),
    trust_score: Math.max(0, Math.min(100, Math.round(score))),
    score: Math.max(0, Math.min(100, Math.round(score))),
    risk_level: toRiskLevel({ score, band: result.band }),
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(4)))),
    mode,
    trust_state: result.trust_state ?? result.trustState ?? "UNKNOWN",
    trust_vector: {
      executionReliability: Math.max(0, Math.min(100, Math.round(toNumeric(vector.executionReliability, score)))),
      economicIntegrity: Math.max(0, Math.min(100, Math.round(toNumeric(vector.economicIntegrity, score)))),
      identityCredibility: Math.max(0, Math.min(100, Math.round(toNumeric(vector.identityCredibility, score)))),
      behavioralStability: Math.max(0, Math.min(100, Math.round(toNumeric(vector.behavioralStability, score)))),
      dependencyRisk: Math.max(0, Math.min(100, Math.round(toNumeric(vector.dependencyRisk, 0)))),
      adversarialRisk: Math.max(0, Math.min(100, Math.round(toNumeric(vector.adversarialRisk, 0)))),
      evidenceFreshness: Math.max(0, Math.min(100, Math.round(toNumeric(vector.evidenceFreshness, 0)))),
      overallTrust: Math.max(0, Math.min(100, Math.round(toNumeric(vector.overallTrust, score))))
    },
    last_updated: result.expires_at ?? new Date().toISOString(),
    signals: buildSignals(result),
    policy: {
      route,
      reason
    },
    policy_engine: policy,
    evidence,
    agentic_market: agenticMarket
  };
}

function reasonsFromResult(result = {}) {
  if (Array.isArray(result.reason_codes) && result.reason_codes.length > 0) {
    return result.reason_codes.map(String);
  }
  if (typeof result.reason === "string" && result.reason.trim()) {
    return [result.reason.trim()];
  }
  if (typeof result.decision === "string" && result.decision.trim()) {
    return [result.decision.trim()];
  }
  return ["policy_default"];
}

function toResolveTrustV1Response(request, toolOutput, config) {
  const result = toolOutput?.result ?? {};
  const trustResponse = toTrustScoreResponse(request, toolOutput);
  const receipt = toolOutput?.meta?.x402_receipt ?? null;
  const network = receipt?.network
    ?? toolOutput?.meta?.x402_receipt?.paymentRequirements?.network
    ?? (config.x402SupportedNetworks ?? [])[0]
    ?? null;
  const asset = receipt?.asset
    ?? toolOutput?.meta?.x402_receipt?.paymentRequirements?.asset
    ?? config.x402PaymentAssetAddress
    ?? (config.x402AcceptedAssets ?? [])[0]
    ?? null;

  return {
    subject_id: String(result.subject_id ?? request.entity_id),
    trust_score: trustResponse.trust_score,
    risk_level: trustResponse.risk_level,
    confidence: trustResponse.confidence,
    route: trustResponse.policy.route,
    status: trustResponse.policy.route,
    reasons: reasonsFromResult(result),
    receipt: {
      x402_verified: Boolean(toolOutput?.meta?.payment_receipt_id),
      facilitator_provider: receipt?.facilitator_provider ?? config.x402FacilitatorProvider ?? "openfacilitator",
      network,
      asset,
      payTo: receipt?.payTo ?? config.x402PayTo ?? null,
      price: receipt?.price ?? config.x402Price ?? config.x402PriceUsd ?? config.x402PricePerUnitAtomic ?? null,
      payment_receipt_id: toolOutput?.meta?.payment_receipt_id ?? null,
      verifier_reference: receipt?.verifier_reference ?? toolOutput?.meta?.verifier_reference ?? null,
      settlement_status: receipt?.settlement_status ?? null
    }
  };
}

function buildInfopunksTrustLayerManifest(config) {
  const origin = (config.publicUrl ?? `http://${config.host}:${config.port}`).replace(/\/$/, "");
  const resolveTrustTool = findTool("resolve_trust");
  return {
    name: "Infopunks Trust Layer",
    slug: "infopunks-trust-layer",
    version: config.adapterVersion,
    description: "x402-gated trust resolution for agent routing and Agentic.Market discovery.",
    endpoints: {
      health: `${origin}/health`,
      openapi: `${origin}/openapi.json`,
      resolve_trust: `${origin}/v1/resolve-trust`,
      events_recent: `${origin}/v1/events/recent`
    },
    resources: {
      resolve_trust: {
        method: "POST",
        ...routeResourceMetadata(config, resolveTrustTool, "/v1/resolve-trust")
      }
    },
    payment: {
      rail: "x402",
      network: (config.x402SupportedNetworks ?? [])[0] ?? null,
      asset: (config.x402AcceptedAssets ?? [])[0] ?? null,
      price_usd: config.x402PriceUsd ?? null,
      price: displayPrice(config.x402Price ?? config.x402PriceUsd ?? null),
      price_atomic: config.x402PricePerUnitAtomic,
      pay_to_configured: Boolean(config.x402PayTo),
      facilitator_provider: config.x402FacilitatorProvider ?? "openfacilitator"
    },
    discoverability: {
      agentic_market_listing: `${origin}/.well-known/infopunks-trust-layer.json`
    }
  };
}

function buildOpenApiJson(origin, config) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Infopunks Trust Layer API",
      version: config.adapterVersion,
      description: "Public x402-gated trust resolution surface for Agentic.Market."
    },
    servers: [{ url: origin }],
    paths: {
      "/health": {
        get: {
          summary: "Liveness check",
          responses: {
            200: {
              description: "Service is reachable",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      },
      "/.well-known/infopunks-trust-layer.json": {
        get: {
          summary: "Infopunks Trust Layer discovery metadata",
          responses: {
            200: {
              description: "Discovery metadata",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI document",
          responses: {
            200: {
              description: "OpenAPI JSON",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      },
      "/v1/resolve-trust": {
        post: {
          summary: "Resolve trust with x402 payment gating",
          description: RESOLVE_TRUST_BAZAAR_DESCRIPTION,
          extensions: {
            bazaar: RESOLVE_TRUST_BAZAAR_EXTENSION
          },
          "x-bazaar": RESOLVE_TRUST_BAZAAR_EXTENSION,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ResolveTrustRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Trust response",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ResolveTrustResponse" }
                }
              }
            },
            402: {
              description: "Payment required",
              headers: {
                "PAYMENT-REQUIRED": { schema: { type: "string" } },
                "x402-required": { schema: { type: "string", const: "true" } },
                "x402-payment-rail": { schema: { type: "string", const: "x402" } },
                "x402-accepted-assets": { schema: { type: "string" } },
                "x402-supported-networks": { schema: { type: "string" } }
              }
            }
          }
        }
      },
      "/v1/events/recent": {
        get: {
          summary: "Recent sanitized payment/trust events",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 50, default: 25 }
            }
          ],
          responses: {
            200: {
              description: "Recent events",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      count: { type: "integer" },
                      events: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            event_id: { type: "string" },
                            event_type: { type: "string" },
                            timestamp: { type: "string" },
                            subject_id: { type: "string" },
                            trust_score: { type: "number" },
                            route: { type: "string" },
                            confidence: { type: "number" },
                status: { type: "string" },
                facilitator_provider: { type: "string" },
                network: { type: "string" },
                payTo: { type: "string" },
                price: { type: "string" },
                risk_level: { type: "string" },
                receipt_id: { type: "string" },
                reason: { type: "string" }
                          }
                        }
                      }
                    },
                    required: ["count", "events"]
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        ResolveTrustRequest: {
          type: "object",
          properties: {
            subject_id: { type: "string" },
            context: { type: "object", additionalProperties: true },
            payment: { type: "object", additionalProperties: true }
          },
          required: ["subject_id"]
        },
        ResolveTrustResponse: {
          type: "object",
          properties: {
            ...RESOLVE_TRUST_RESPONSE_SCHEMA.properties,
            confidence: { type: "number" },
            reasons: { type: "array", items: { type: "string" } },
            receipt: {
              type: "object",
              properties: {
                x402_verified: { type: "boolean" },
                facilitator_provider: { type: "string" },
                network: { type: "string" },
                asset: { type: "string" },
                payTo: { type: "string" },
                price: { type: "string" }
              },
              required: ["x402_verified", "network", "asset"]
            }
          },
          required: ["subject_id", "trust_score", "route", "reasons", "receipt"]
        }
      }
    }
  };
}

function sanitizePublicEvent(event = {}) {
  const status = event.status ?? null;
  const route = ["allow", "degrade", "block", "quarantine"].includes(String(event.route ?? status ?? "").toLowerCase())
    ? String(event.route ?? status).toLowerCase()
    : null;
  return {
    event_id: event.event_id ?? null,
    event_type: event.event_type ?? null,
    timestamp: event.timestamp ?? null,
    subject_id: event.subject_id ?? null,
    trust_score: toNumeric(event.trust_score, null),
    route,
    confidence: toNumeric(event.confidence, null),
    status,
    receipt_id: event.receipt_id ?? null,
    facilitator_provider: event.facilitator_provider ?? null,
    network: event.network ?? null,
    payTo: event.payTo ?? event.pay_to ?? null,
    price: event.price ?? null,
    risk_level: event.risk_level ?? null,
    reason: event.reason ?? null
  };
}

function statusFromAdapterErrorCode(code, fallback = 500) {
  if (code === "REPLAY_DETECTED") {
    return 409;
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return 409;
  }
  if (code === "REQUEST_TIMESTAMP_INVALID") {
    return 400;
  }
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
  void metrics;
  const server = http.createServer(async (req, res) => {
    const method = String(req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" }, corsHeaders());
      return;
    }

    if (method === "GET" && url.pathname === "/v1/events/recent") {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 25));
      const events = await mcpServer.warRoomFeed?.listLatest?.(limit) ?? [];
      const sanitized = Array.isArray(events) ? events.slice(0, limit).map((entry) => sanitizePublicEvent(entry)) : [];
      sendJson(
        res,
        200,
        { count: sanitized.length, events: sanitized },
        corsHeaders()
      );
      return;
    }

    if (method === "POST" && url.pathname === "/v1/resolve-trust") {
      const endpointPath = url.pathname;
      const requestId = typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].trim()
        ? req.headers["x-request-id"].trim()
        : `req_${randomUUID()}`;
      const toolDef = findTool("resolve_trust");
      const headerPayment = paymentFromHeaders(req.headers, config.x402FacilitatorProvider);
      if (!headerPayment && !hasRequestBody(req)) {
        sendJson(
          res,
          402,
          {
            error: {
              code: "ENTITLEMENT_REQUIRED",
              message: "x402 payment is required for this endpoint."
            }
          },
          {
            ...corsHeaders(),
            ...challengeHeaders(config, toolDef, endpointPath),
            "x-request-id": requestId
          }
        );
        logger.info({
          event: "402_challenge_issued",
          request_id: requestId,
          adapter_trace_id: null,
          endpoint: endpointPath,
          entity_id: null,
          code: "ENTITLEMENT_REQUIRED"
        });
        return;
      }
      if (!contentTypeIsJson(req)) {
        sendJson(res, 415, { error: "content_type_must_be_application_json" }, { ...corsHeaders(), "x-request-id": requestId });
        return;
      }
      let bodyAndRaw;
      try {
        bodyAndRaw = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: "invalid_json", message: error?.message ?? "invalid_json" }, { ...corsHeaders(), "x-request-id": requestId });
        return;
      }
      const body = mergeHeaderPayment(bodyAndRaw.parsed ?? {}, req.headers, config.x402FacilitatorProvider);
      const suppliedPayment = headerPayment || hasBodyPayment(body?.payment);
      if (!suppliedPayment) {
        sendJson(
          res,
          402,
          {
            error: {
              code: "ENTITLEMENT_REQUIRED",
              message: "x402 payment is required for this endpoint."
            }
          },
          {
            ...corsHeaders(),
            ...challengeHeaders(config, toolDef, endpointPath),
            "x-request-id": requestId
          }
        );
        logger.info({
          event: "402_challenge_issued",
          request_id: requestId,
          adapter_trace_id: null,
          endpoint: endpointPath,
          entity_id: null,
          code: "ENTITLEMENT_REQUIRED"
        });
        return;
      }
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
          { ...corsHeaders(), "x-request-id": requestId }
        );
        return;
      }
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
        event: "incoming_request",
        request_id: requestId,
        adapter_trace_id: adapterTraceId,
        endpoint: endpointPath,
        entity_id: normalized.entity_id,
        ip: req.socket?.remoteAddress ?? "unknown"
      });

      try {
        const output = await mcpServer.executeTool(
          toolDef,
          args,
          adapterTraceId,
          { headers: { ...req.headers, "x-request-id": requestId }, ip: req.socket?.remoteAddress ?? null }
        );
        logger.info({
          event: "payment_verified",
          request_id: requestId,
          adapter_trace_id: adapterTraceId,
          endpoint: endpointPath,
          entity_id: normalized.entity_id,
          billed_units: output?.meta?.billed_units ?? 0,
          payment_receipt_id: output?.meta?.payment_receipt_id ?? null,
          facilitator_provider: config.x402FacilitatorProvider ?? "openfacilitator",
          network: output?.meta?.x402_receipt?.network ?? (config.x402SupportedNetworks ?? [])[0] ?? null,
          payTo: output?.meta?.x402_receipt?.payTo ?? config.x402PayTo ?? null,
          price: output?.meta?.x402_receipt?.price ?? config.x402Price ?? config.x402PricePerUnitAtomic ?? null
        });
        if (output?.meta?.payment_receipt_id) {
          logger.info({
            event: "receipt_logged",
            request_id: requestId,
            adapter_trace_id: adapterTraceId,
            endpoint: endpointPath,
            entity_id: normalized.entity_id,
            payment_receipt_id: output.meta.payment_receipt_id
          });
        }

        const trustResponse = toResolveTrustV1Response(normalized, output, config);
        await mcpServer.warRoomFeed?.record?.({
          event_type: "paid_call.success",
          timestamp: new Date().toISOString(),
          subject_id: trustResponse.subject_id,
          trust_score: trustResponse.trust_score,
          confidence: trustResponse.confidence,
          status: trustResponse.route,
          route: trustResponse.route,
          risk_level: trustResponse.risk_level,
          receipt_id: trustResponse.receipt?.payment_receipt_id,
          facilitator_provider: trustResponse.receipt?.facilitator_provider ?? config.x402FacilitatorProvider ?? "openfacilitator",
          network: trustResponse.receipt?.network ?? null,
          payTo: trustResponse.receipt?.payTo ?? config.x402PayTo ?? null,
          price: trustResponse.receipt?.price ?? config.x402Price ?? config.x402PricePerUnitAtomic ?? null,
          reason: Array.isArray(trustResponse.reasons) && trustResponse.reasons.length > 0 ? trustResponse.reasons[0] : null
        });
        logger.info({
          event: "trust_subject_resolved",
          request_id: requestId,
          adapter_trace_id: adapterTraceId,
          endpoint: endpointPath,
          subject_id: trustResponse.subject_id ?? trustResponse.entity_id,
          trust_score: trustResponse.trust_score
        });
        sendJson(res, 200, trustResponse, {
          ...corsHeaders(),
          "x-request-id": requestId,
          "x402-discovery": `${config.publicUrl ?? `http://${config.host}:${config.port}`}/.well-known/infopunks-trust-layer.json`
        });
        logger.info({
          event: "final_route_returned",
          request_id: requestId,
          adapter_trace_id: adapterTraceId,
          endpoint: endpointPath,
          entity_id: normalized.entity_id,
          trust_score: trustResponse.trust_score,
          route: trustResponse.route ?? trustResponse.policy?.route
        });
      } catch (error) {
        const errorEnvelope = toMcpToolError(error, adapterTraceId, toolDef.operation).structuredContent;
        const code = errorEnvelope?.error?.code ?? "UPSTREAM_UNAVAILABLE";
        const statusCode = statusFromAdapterErrorCode(code, error?.status ?? 500);
        const extraHeaders = PAYMENT_ERROR_CODES.has(code) ? challengeHeaders(config, toolDef, endpointPath) : {};

        if (PAYMENT_ERROR_CODES.has(code)) {
          logger.info({
            event: statusCode === 402 ? "402_challenge_issued" : "payment_failed",
            request_id: requestId,
            adapter_trace_id: adapterTraceId,
            endpoint: endpointPath,
            entity_id: normalized.entity_id,
            code
          });
        } else {
          logger.error({
            event: "trust_score_error",
            request_id: requestId,
            adapter_trace_id: adapterTraceId,
            endpoint: endpointPath,
            entity_id: normalized.entity_id,
            code,
            message: errorEnvelope?.error?.message ?? "trust_score_route_failed"
          });
        }
        sendJson(res, statusCode, errorEnvelope, { ...corsHeaders(), ...extraHeaders, "x-request-id": requestId });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/.well-known/infopunks-trust-layer.json") {
      sendJson(res, 200, buildInfopunksTrustLayerManifest(config), corsHeaders());
      return;
    }

    if (method === "GET" && url.pathname === "/openapi.json") {
      const origin = (config.publicUrl ?? `http://${config.host}:${config.port}`).replace(/\/$/, "");
      sendJson(res, 200, buildOpenApiJson(origin, config), corsHeaders());
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
            resolve_trust_endpoint: `${config.publicUrl ?? `http://${config.host}:${config.port}`}/v1/resolve-trust`
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
  contentTypeIsJson,
  statusFromAdapterErrorCode,
  validateJsonSchema,
  challengeHeaders,
  normalizeTrustScoreRequest,
  toTrustScoreResponse,
  toResolveTrustV1Response,
  toPolicyRoute,
  toRiskLevel
};
