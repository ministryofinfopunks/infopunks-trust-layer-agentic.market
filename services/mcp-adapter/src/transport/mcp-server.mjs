import { findTool, TOOL_REGISTRY } from "../config/tool-registry.mjs";
import { createHash } from "node:crypto";
import { validateToolInput } from "../schemas/tool-inputs.mjs";
import { extractInternalTraceId, mcpSuccessEnvelope, normalizeResult } from "../schemas/tool-outputs.mjs";
import { buildCallerContext } from "../identity/caller-context.mjs";
import { ensureTraceId } from "../middleware/request-id.mjs";
import { toMcpToolError } from "../middleware/error-handler.mjs";
import { authorizePaidCall } from "../middleware/authz.mjs";
import { makeAdapterError } from "../schemas/error-schema.mjs";
import { resolvePaidRequestGuardStore } from "../payments/request-guard-store.mjs";

function stableStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstReason(result = {}) {
  if (typeof result?.reason === "string" && result.reason.trim()) {
    return result.reason.trim();
  }
  if (Array.isArray(result?.reason_codes) && result.reason_codes.length > 0) {
    return String(result.reason_codes[0]);
  }
  return null;
}

function looksUnsafeDecision(result = {}) {
  const decision = String(result?.decision ?? result?.policy?.route ?? "").toLowerCase();
  return decision.includes("block")
    || decision.includes("quarantine")
    || decision.includes("restrict")
    || decision.includes("deny");
}

function riskLevelFromScore(score) {
  const numeric = toNumeric(score);
  if (numeric == null) {
    return null;
  }
  if (numeric >= 80) {
    return "low";
  }
  if (numeric >= 40) {
    return "medium";
  }
  return "high";
}

function normalizeTimestamp(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return value;
    }
    return value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return normalizeTimestamp(asNumber);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractRequestGuard(args = {}, operation) {
  const payment = args.payment ?? {};
  const nonce = payment?.nonce
    ?? payment?.paymentPayload?.payload?.authorization?.nonce
    ?? null;
  const idempotencyKey = payment?.idempotency_key
    ?? payment?.idempotencyKey
    ?? args.idempotency_key
    ?? args.idempotencyKey
    ?? `auto:${operation}:${args.subject_id ?? "unknown"}:${nonce ?? "none"}`;
  const timestampRaw = payment?.timestamp
    ?? payment?.request_timestamp
    ?? payment?.requestTimestamp
    ?? args.request_timestamp
    ?? args.requestTimestamp
    ?? Date.now();
  const timestampMs = normalizeTimestamp(timestampRaw);
  return {
    nonce: typeof nonce === "string" && nonce.trim() ? nonce.trim() : null,
    idempotencyKey: String(idempotencyKey),
    timestampMs
  };
}

function publicToolView(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    pricing: tool.pricing
  };
}

export class McpServer {
  constructor({
    config,
    logger,
    metrics,
    rateLimiter,
    entitlementService,
    subjectResolution,
    apiClient,
    toolHandlers,
    tokenValidator,
    store,
    reconciliationService
  }) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.rateLimiter = rateLimiter;
    this.entitlementService = entitlementService;
    this.subjectResolution = subjectResolution;
    this.apiClient = apiClient;
    this.toolHandlers = toolHandlers;
    this.tokenValidator = tokenValidator;
    this.store = store;
    this.reconciliationService = reconciliationService;
    this.requestGuardStore = resolvePaidRequestGuardStore({ store, config, logger });
    this.warRoomFeed = null;
  }

  async recordWarRoomEvent(event) {
    if (!this.warRoomFeed?.record) {
      return;
    }
    try {
      await this.warRoomFeed.record(event);
    } catch (error) {
      this.logger?.warn?.({
        event: "war_room_event_write_failed",
        message: error?.message ?? "unknown_error"
      });
    }
  }

  async initialize() {
    const healthy = await this.apiClient.health();
    return {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: this.config.adapterName,
        version: this.config.adapterVersion
      },
      capabilities: {
        tools: {},
        ...(healthy ? {} : { warnings: ["core_api_unhealthy"] })
      }
    };
  }

  async executeTool(toolDef, args, adapterTraceId, transportContext = {}) {
    validateToolInput(toolDef.operation, args);
    const isPaidOperation = toolDef.pricing?.mode === "metered" && this.config.x402RequiredDefault;
    let requestGuard = null;
    if (isPaidOperation) {
      const extracted = extractRequestGuard(args, toolDef.operation);
      const nowMs = Date.now();
      const windowMs = Number(this.config.paidRequestTimestampWindowSeconds ?? 120) * 1000;
      if (!Number.isFinite(extracted.timestampMs) || Math.abs(nowMs - extracted.timestampMs) > windowMs) {
        await this.recordWarRoomEvent({
          event_type: "paid_call.request_timestamp_invalid",
          timestamp: new Date().toISOString(),
          payer: args?.payment?.payer ?? null,
          subject_id: args?.subject_id ?? null,
          status: "rejected",
          amount: toolDef.pricing?.units ?? 0,
          error_code: "REQUEST_TIMESTAMP_INVALID",
          reason: "Request timestamp is outside the accepted validity window."
        });
        this.logger?.warn?.({
          event: "paid_call_event",
          payer: args?.payment?.payer ?? null,
          subject_id: args?.subject_id ?? null,
          receipt_id: null,
          amount: toolDef.pricing?.units ?? 0,
          timestamp: new Date().toISOString(),
          status: "rejected",
          nonce: extracted.nonce,
          idempotency_key: extracted.idempotencyKey,
          request_hash: null,
          error_code: "REQUEST_TIMESTAMP_INVALID",
          mode: this.config.x402VerifierMode ?? null
        });
        throw makeAdapterError(
          "REQUEST_TIMESTAMP_INVALID",
          "Request timestamp is outside the accepted validity window.",
          {
            request_timestamp_ms: extracted.timestampMs ?? null,
            now_ms: nowMs,
            window_seconds: Number(this.config.paidRequestTimestampWindowSeconds ?? 120)
          },
          false,
          400
        );
      }

      const normalizedArgs = JSON.parse(JSON.stringify(args ?? {}));
      if (normalizedArgs?.payment && typeof normalizedArgs.payment === "object") {
        delete normalizedArgs.payment.idempotency_key;
        delete normalizedArgs.payment.idempotencyKey;
        delete normalizedArgs.payment.timestamp;
        delete normalizedArgs.payment.request_timestamp;
        delete normalizedArgs.payment.requestTimestamp;
      }
      delete normalizedArgs.idempotency_key;
      delete normalizedArgs.idempotencyKey;
      delete normalizedArgs.request_timestamp;
      delete normalizedArgs.requestTimestamp;
      const requestHash = sha256(stableStringify({ operation: toolDef.operation, args: normalizedArgs }));

      const reservation = await this.requestGuardStore.reserveIdempotencyKey({
        key: extracted.idempotencyKey,
        requestHash,
        payer: args?.payment?.payer ?? null,
        subjectId: args?.subject_id ?? null,
        nonce: extracted.nonce,
        mode: this.config.x402VerifierMode ?? null
      });
      if (!reservation.ok) {
        await this.recordWarRoomEvent({
          event_type: "paid_call.idempotency_conflict",
          timestamp: new Date().toISOString(),
          payer: args?.payment?.payer ?? null,
          subject_id: args?.subject_id ?? null,
          status: "rejected",
          amount: toolDef.pricing?.units ?? 0,
          error_code: "IDEMPOTENCY_CONFLICT",
          reason: "Idempotency key already used with a different payload."
        });
        this.logger?.warn?.({
          event: "paid_call_event",
          payer: args?.payment?.payer ?? null,
          subject_id: args?.subject_id ?? null,
          receipt_id: null,
          amount: toolDef.pricing?.units ?? 0,
          timestamp: new Date().toISOString(),
          status: "rejected",
          nonce: extracted.nonce,
          idempotency_key: extracted.idempotencyKey,
          request_hash: requestHash,
          error_code: "IDEMPOTENCY_CONFLICT",
          mode: this.config.x402VerifierMode ?? null
        });
        throw makeAdapterError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key has already been used with a different request payload.",
          reservation.details ?? {},
          false,
          409
        );
      }
      if (!reservation.created) {
        const cached = reservation.record;
        if (cached?.status_code != null && cached?.response != null) {
          await this.recordWarRoomEvent({
            event_type: cached.status_code >= 200 && cached.status_code < 300
              ? "paid_call.idempotent_replay_served"
              : "paid_call.idempotent_error_served",
            timestamp: new Date().toISOString(),
            payer: args?.payment?.payer ?? cached.payer ?? null,
            subject_id: args?.subject_id ?? cached.subject_id ?? null,
            status: cached.status_code >= 200 && cached.status_code < 300 ? "success" : "failed",
            receipt_id: cached.receipt_id ?? null,
            amount: toolDef.pricing?.units ?? 0,
            error_code: cached.error_code ?? null,
            reason: cached.status_code >= 200 && cached.status_code < 300
              ? "Idempotent request served from cache."
              : "Idempotent request returned cached error response."
          });
          this.logger?.info?.({
            event: "paid_call_event",
            payer: args?.payment?.payer ?? cached.payer ?? null,
            subject_id: args?.subject_id ?? cached.subject_id ?? null,
            receipt_id: cached.receipt_id ?? null,
            amount: toolDef.pricing?.units ?? 0,
            timestamp: new Date().toISOString(),
            status: "cached",
            nonce: extracted.nonce ?? cached.nonce ?? null,
            idempotency_key: extracted.idempotencyKey,
            request_hash: requestHash,
            error_code: cached.error_code ?? null,
            mode: this.config.x402VerifierMode ?? null
          });
          if (cached.status_code >= 200 && cached.status_code < 300) {
            return cached.response;
          }
          const cachedError = cached.response?.error ?? {};
          throw makeAdapterError(
            cached.error_code ?? cachedError.code ?? "UPSTREAM_UNAVAILABLE",
            cachedError.message ?? "Returning cached idempotent error response.",
            cachedError.details ?? { idempotency_key: extracted.idempotencyKey },
            false,
            cached.status_code ?? 409
          );
        }
        throw makeAdapterError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotent request is already in progress.",
          { idempotency_key: extracted.idempotencyKey },
          false,
          409
        );
      }
      requestGuard = {
        nonce: extracted.nonce,
        idempotencyKey: extracted.idempotencyKey,
        requestHash,
        mode: this.config.x402VerifierMode ?? null
      };
    }

    const callerContext = buildCallerContext({ args, adapterTraceId });
    const ip = transportContext.ip ?? "unknown";
    const rateKey = [
      ip,
      callerContext.payer ?? "anon",
      callerContext.external_agent_id ?? "unknown_agent",
      transportContext.headers?.["x-entitlement-session"] ?? "no_session"
    ].join(":");
    await this.rateLimiter.hit(rateKey);

    const entitlementExemptTools = new Set(this.config.entitlementExemptTools ?? []);
    const isEntitlementExempt = entitlementExemptTools.has(toolDef.name) || entitlementExemptTools.has(toolDef.operation);
    const requiresEntitlementToken = Boolean(
      !isEntitlementExempt && (
        this.config.entitlementTokenRequired ||
        (this.config.entitlementRequireForPaidTools && toolDef.pricing?.mode === "metered")
      )
    );
    const extractedToken = this.tokenValidator?.extractToken(transportContext) ?? null;
    let entitlement = null;
    if (this.tokenValidator && (requiresEntitlementToken || extractedToken)) {
      entitlement = await this.tokenValidator.validate({
        token: extractedToken,
        toolName: toolDef.name,
        adapterTraceId,
        callerContext,
        paymentContext: args.payment ?? null,
        required: requiresEntitlementToken
      });
    }

    let caller = null;
    if (args.agent) {
      caller = await this.subjectResolution.resolveCaller(args.agent ?? {}, this.config.callerResolutionPolicy, adapterTraceId);
    }

    let billing = null;
    try {
      billing = await authorizePaidCall({
        entitlementService: this.entitlementService,
        operation: toolDef.operation,
        args,
        callerSubjectId: caller?.subject_id,
        adapterTraceId,
        entitlement,
        requestGuard
      });

      const started = Date.now();
      const handler = this.toolHandlers[toolDef.handler];
      if (!handler) {
        throw makeAdapterError("INVALID_INPUT", `No handler bound for ${toolDef.name}.`, { tool: toolDef.name }, false, 500);
      }

      let upstream;
      try {
        upstream = await handler({
          args,
          config: {
            ...this.config,
            stateStore: this.store,
            logger: this.logger
          },
          apiClient: this.apiClient,
          subjectResolution: this.subjectResolution,
          caller,
          adapterTraceId
        });
      } catch (error) {
        if (billing?.payment_receipt_id) {
          await this.store.updateReceiptSettlement({
            receiptId: billing.payment_receipt_id,
            verifierReference: billing.verifier_reference ?? null,
            receiptStatus: "failed",
            settlementStatus: "failed",
            settledAt: null,
            reversedAt: null,
            lastError: error?.code ?? error?.message ?? "tool_call_failed"
          });
        }

        await this.store.recordToolUsage({
          adapterTraceId,
          toolName: toolDef.name,
          payer: billing?.payer ?? entitlement?.payer ?? callerContext.payer ?? null,
          callerSubjectId: caller?.subject_id ?? null,
          targetSubjectId: args.subject_id ?? null,
          billedUnits: billing?.billed_units ?? 0,
          receiptId: billing?.payment_receipt_id ?? null,
          usageStatus: "failed"
        });

        error.billingContext = {
          billed_units: billing?.billed_units ?? 0,
          payment_receipt_id: billing?.payment_receipt_id ?? null
        };
        throw error;
      }

      const latencyMs = Date.now() - started;
      const internalTraceId = extractInternalTraceId(toolDef.operation, upstream);

      this.metrics.inc("tool_calls_total", 1);
      this.metrics.inc(`tool_calls_${toolDef.operation}`, 1);
      this.logger.info({
        event: "tool_call",
        tool: toolDef.name,
        operation: toolDef.operation,
        adapter_trace_id: adapterTraceId,
        internal_trace_id: internalTraceId,
        billed_units: billing.billed_units,
        latency_ms: latencyMs
      });

      if (billing.payment_receipt_id && internalTraceId) {
        await this.store.setReceiptInternalTrace(billing.payment_receipt_id, internalTraceId);
      }
      await this.store.recordToolUsage({
        adapterTraceId,
        toolName: toolDef.name,
        payer: billing.payer ?? entitlement?.payer ?? callerContext.payer ?? null,
        callerSubjectId: caller?.subject_id ?? null,
        targetSubjectId: args.subject_id ?? null,
        billedUnits: billing.billed_units ?? 0,
        receiptId: billing.payment_receipt_id ?? null,
        usageStatus: "accepted"
      });
      if (billing.payment_receipt_id && typeof this.store.recordBillingLedgerEntry === "function") {
        await this.store.recordBillingLedgerEntry({
          adapterTraceId,
          requestId: transportContext.headers?.["x-request-id"] ?? null,
          toolName: toolDef.name,
          payer: billing.payer ?? entitlement?.payer ?? callerContext.payer ?? null,
          subjectId: args.subject_id ?? null,
          billedUnits: billing.billed_units ?? 0,
          receiptId: billing.payment_receipt_id,
          network: billing.x402_receipt?.network ?? (this.config.x402SupportedNetworks ?? [])[0] ?? null,
          asset: billing.x402_receipt?.asset ?? this.config.x402PaymentAssetAddress ?? null,
          priceAtomic: this.config.x402PricePerUnitAtomic,
          status: "paid"
        });
      }
      await this.store.recordRequestLog({
        adapterTraceId,
        toolName: toolDef.name,
        statusCode: 200,
        errorCode: null,
        latencyMs,
        billedUnits: billing.billed_units ?? 0,
        receiptId: billing.payment_receipt_id ?? null,
        internalTraceId,
        details: {
          operation: toolDef.operation,
          verifier_reference: billing.verifier_reference ?? null
        }
      });

      const responseEnvelope = mcpSuccessEnvelope({
        result: normalizeResult(toolDef.operation, upstream, args),
        meta: {
          tool: toolDef.name,
          adapter_trace_id: adapterTraceId,
          internal_trace_id: internalTraceId,
          billed_units: billing.billed_units,
          payment_receipt_id: billing.payment_receipt_id,
          x402_receipt: billing.x402_receipt,
          spend_controls: billing.spend_controls,
          latency_ms: latencyMs
        }
      });
      if (isPaidOperation && toolDef.operation === "resolve_trust") {
        const normalized = responseEnvelope?.result ?? {};
        let eventType = "paid_call.success";
        let status = "success";
        if (String(normalized?.mode ?? "").toLowerCase() === "degraded") {
          eventType = "paid_call.degraded_fallback";
          status = "degraded";
        } else if (looksUnsafeDecision(normalized)) {
          eventType = "paid_call.unsafe_executor_blocked";
          status = "blocked";
        }
        await this.recordWarRoomEvent({
          event_type: eventType,
          timestamp: new Date().toISOString(),
          payer: billing?.payer ?? args?.payment?.payer ?? null,
          subject_id: normalized?.subject_id ?? args?.subject_id ?? null,
          trust_score: toNumeric(normalized?.trust_score ?? normalized?.score),
          trust_tier: normalized?.trust_tier ?? normalized?.band ?? normalized?.trust_state ?? null,
          mode: normalized?.mode ?? "verified",
          confidence: toNumeric(normalized?.confidence),
          status,
          route: normalized?.policy?.route ?? normalized?.decision ?? status,
          risk_level: normalized?.risk_level ?? riskLevelFromScore(normalized?.trust_score ?? normalized?.score),
          receipt_id: billing?.payment_receipt_id ?? null,
          facilitator_provider: billing?.x402_receipt?.facilitator_provider ?? this.config.x402FacilitatorProvider ?? "openfacilitator",
          network: billing?.x402_receipt?.network ?? (this.config.x402SupportedNetworks ?? [])[0] ?? null,
          payTo: billing?.x402_receipt?.payTo ?? this.config.x402PayTo ?? null,
          price: billing?.x402_receipt?.price ?? this.config.x402Price ?? this.config.x402PricePerUnitAtomic ?? null,
          amount: billing?.billed_units ?? toolDef.pricing?.units ?? 0,
          error_code: null,
          reason: firstReason(normalized)
        });
      }
      if (requestGuard) {
        await this.requestGuardStore.finalizeIdempotencyKey({
          key: requestGuard.idempotencyKey,
          statusCode: 200,
          response: responseEnvelope,
          errorCode: null,
          receiptId: billing?.payment_receipt_id ?? null
        });
      }
      return responseEnvelope;
    } catch (error) {
      if (isPaidOperation) {
        const code = error?.code ?? "UPSTREAM_UNAVAILABLE";
        const eventType = code === "REPLAY_DETECTED"
          ? "paid_call.replay_rejected"
          : code === "PAYMENT_VERIFICATION_FAILED" || code === "PAYMENT_SESSION_EXPIRED"
            ? "paid_call.payment_failed"
            : "paid_call.failed";
        await this.recordWarRoomEvent({
          event_type: eventType,
          timestamp: new Date().toISOString(),
          payer: args?.payment?.payer ?? billing?.payer ?? null,
          subject_id: args?.subject_id ?? null,
          status: eventType === "paid_call.replay_rejected" ? "rejected" : "failed",
          receipt_id: billing?.payment_receipt_id ?? null,
          amount: billing?.billed_units ?? toolDef.pricing?.units ?? 0,
          error_code: code,
          reason: error?.message ?? null
        });
        this.logger?.warn?.({
          event: "paid_call_event",
          payer: args?.payment?.payer ?? billing?.payer ?? null,
          subject_id: args?.subject_id ?? null,
          receipt_id: billing?.payment_receipt_id ?? null,
          amount: toolDef.pricing?.units ?? 0,
          timestamp: new Date().toISOString(),
          status: "failed",
          nonce: requestGuard?.nonce ?? args?.payment?.nonce ?? null,
          idempotency_key: requestGuard?.idempotencyKey ?? args?.payment?.idempotency_key ?? null,
          request_hash: requestGuard?.requestHash ?? null,
          error_code: code,
          mode: requestGuard?.mode ?? this.config.x402VerifierMode ?? null
        });
      }
      if (billing?.payment_receipt_id) {
        error.billingContext = {
          billed_units: billing.billed_units ?? 0,
          payment_receipt_id: billing.payment_receipt_id ?? null
        };
      }
      if (requestGuard) {
        const cachedErrorEnvelope = toMcpToolError(error, adapterTraceId, toolDef.operation).structuredContent;
        await this.requestGuardStore.finalizeIdempotencyKey({
          key: requestGuard.idempotencyKey,
          statusCode: error?.status ?? 500,
          response: cachedErrorEnvelope,
          errorCode: error?.code ?? "UPSTREAM_UNAVAILABLE",
          receiptId: billing?.payment_receipt_id ?? null
        });
      }
      throw error;
    }
  }

  async handleRequest(request, transportContext = {}) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" }
      };
    }

    if (request.method === "initialize") {
      return { jsonrpc: "2.0", id: request.id, result: await this.initialize() };
    }

    if (request.method === "notifications/initialized") {
      return null;
    }

    if (request.method === "ping") {
      return { jsonrpc: "2.0", id: request.id, result: {} };
    }

    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id: request.id, result: { tools: TOOL_REGISTRY.map(publicToolView) } };
    }

    if (request.method === "tools/call") {
      const adapterTraceId = ensureTraceId(request);
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      const toolDef = findTool(name);

      if (!toolDef) {
        const error = toMcpToolError(makeAdapterError("INVALID_INPUT", `Unknown tool ${name}.`, { tool: name }, false, 400), adapterTraceId);
        return { jsonrpc: "2.0", id: request.id, result: error };
      }

      try {
        const result = await this.executeTool(toolDef, args, adapterTraceId, transportContext);
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
          }
        };
      } catch (error) {
        this.metrics.inc("tool_errors_total", 1);
        this.metrics.inc(`tool_errors_${toolDef.operation}`, 1);
        this.logger.error({
          event: "tool_error",
          tool: toolDef.name,
          adapter_trace_id: adapterTraceId,
          code: error?.code ?? "UPSTREAM_UNAVAILABLE",
          message: error?.message ?? "Tool call failed"
        });
        await this.store.recordRequestLog({
          adapterTraceId,
          toolName: toolDef.name,
          statusCode: error?.status ?? 500,
          errorCode: error?.code ?? "UPSTREAM_UNAVAILABLE",
          latencyMs: null,
          billedUnits: error?.billingContext?.billed_units ?? null,
          receiptId: error?.billingContext?.payment_receipt_id ?? null,
          internalTraceId: null,
          details: {
            operation: toolDef.operation,
            message: error?.message ?? "Tool call failed"
          }
        });
        await this.store.updateUsageStatus(adapterTraceId, "failed");
        return { jsonrpc: "2.0", id: request.id, result: toMcpToolError(error, adapterTraceId, toolDef.operation) };
      }
    }

    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32601, message: `Method not found: ${request.method}` }
    };
  }
}
