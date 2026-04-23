import { findTool, TOOL_REGISTRY } from "../config/tool-registry.mjs";
import { validateToolInput } from "../schemas/tool-inputs.mjs";
import { extractInternalTraceId, mcpSuccessEnvelope, normalizeResult } from "../schemas/tool-outputs.mjs";
import { buildCallerContext } from "../identity/caller-context.mjs";
import { ensureTraceId } from "../middleware/request-id.mjs";
import { toMcpToolError } from "../middleware/error-handler.mjs";
import { authorizePaidCall } from "../middleware/authz.mjs";
import { makeAdapterError } from "../schemas/error-schema.mjs";

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

    const billing = await authorizePaidCall({
      entitlementService: this.entitlementService,
      operation: toolDef.operation,
      args,
      callerSubjectId: caller?.subject_id,
      adapterTraceId,
      entitlement
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
        config: this.config,
        apiClient: this.apiClient,
        subjectResolution: this.subjectResolution,
        caller,
        adapterTraceId
      });
    } catch (error) {
      if (billing.payment_receipt_id) {
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
        payer: billing.payer ?? entitlement?.payer ?? callerContext.payer ?? null,
        callerSubjectId: caller?.subject_id ?? null,
        targetSubjectId: args.subject_id ?? null,
        billedUnits: billing.billed_units ?? 0,
        receiptId: billing.payment_receipt_id ?? null,
        usageStatus: "failed"
      });

      error.billingContext = {
        billed_units: billing.billed_units ?? 0,
        payment_receipt_id: billing.payment_receipt_id ?? null
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

    return mcpSuccessEnvelope({
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
