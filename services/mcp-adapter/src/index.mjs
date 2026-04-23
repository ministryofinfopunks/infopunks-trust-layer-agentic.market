#!/usr/bin/env node
import readline from "node:readline";
import { loadEnv } from "./config/env.mjs";
import { InfopunksApiClient } from "./client/infopunks-api-client.mjs";
import { PassportMapper } from "./identity/passport-mapper.mjs";
import { SubjectResolutionService } from "./identity/subject-resolution.mjs";
import { EntitlementService } from "./payments/entitlements.mjs";
import { X402Verifier } from "./payments/x402-verifier.mjs";
import { ReconciliationService } from "./payments/reconciliation-service.mjs";
import { Logger } from "./observability/logger.mjs";
import { Metrics } from "./observability/metrics.mjs";
import { AdapterRateLimiter } from "./middleware/rate-limit.mjs";
import { createRateLimitStrategy } from "./middleware/rate-limit-strategy.mjs";
import { McpServer } from "./transport/mcp-server.mjs";
import { createHttpTransport } from "./transport/http-server.mjs";
import { createAdapterStateStore } from "./storage/factory.mjs";
import { EntitlementTokenValidator } from "./security/entitlement-token.mjs";
import { createIdentityMappingStore } from "./identity/mapping-store.mjs";

import { getPassportTool } from "./tools/get-passport.mjs";
import { resolveTrustTool } from "./tools/resolve-trust.mjs";
import { selectValidatorsTool } from "./tools/select-validators.mjs";
import { selectExecutorTool } from "./tools/select-executor.mjs";
import { evaluateDisputeTool } from "./tools/evaluate-dispute.mjs";
import { getTraceReplayTool } from "./tools/get-trace-replay.mjs";
import { getPromptPackTool } from "./tools/get-prompt-pack.mjs";
import { exportPortabilityTool } from "./tools/export-portability.mjs";
import { importPortabilityTool } from "./tools/import-portability.mjs";
import { quoteRiskTool } from "./tools/quote-risk.mjs";

const config = loadEnv();
const logger = new Logger(config.logLevel);
const metrics = new Metrics();
logger.info({
  event: "adapter_core_auth_config",
  auth_header_type: "authorization:bearer",
  auth_token_source: config.internalServiceTokenSource
});
const apiClient = new InfopunksApiClient({
  baseUrl: config.backendBaseUrl,
  token: config.internalServiceToken,
  tokenSource: config.internalServiceTokenSource,
  logger
});
const identityMappingStore = await createIdentityMappingStore(config);
const mapper = new PassportMapper({ mapPath: config.identityMapPath, environment: config.environment, store: identityMappingStore });
const subjectResolution = new SubjectResolutionService({ apiClient, mapper, config });
const store = await createAdapterStateStore(config);
const verifier = new X402Verifier({
  mode: config.x402VerifierMode,
  verifierUrl: config.x402VerifierUrl,
  verifierApiKey: config.x402VerifierApiKey,
  timeoutMs: config.x402VerifierTimeoutMs,
  sharedSecret: config.x402SharedSecret,
  logger
});
const tokenValidator = new EntitlementTokenValidator({ config, store, logger });
const reconciliationService = new ReconciliationService({
  store,
  verifier,
  logger,
  lockTtlSeconds: config.reconciliationLockTtlSeconds
});
const entitlementService = new EntitlementService({
  verifier,
  store,
  config,
  logger,
  metrics
});
const rateLimiter = new AdapterRateLimiter(config.adapterRateLimitPerMinute, await createRateLimitStrategy(config));

const toolHandlers = {
  get_passport: getPassportTool,
  resolve_trust: resolveTrustTool,
  select_validators: selectValidatorsTool,
  select_executor: selectExecutorTool,
  evaluate_dispute: evaluateDisputeTool,
  get_trace_replay: getTraceReplayTool,
  get_prompt_pack: getPromptPackTool,
  export_portability_bundle: exportPortabilityTool,
  import_portability_bundle: importPortabilityTool,
  quote_risk: quoteRiskTool
};

const server = new McpServer({
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
});

function startStdioTransport() {
  function writeMessage(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let processing = Promise.resolve();

  rl.on("line", (line) => {
    processing = processing.then(async () => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let request;
      try {
        request = JSON.parse(trimmed);
      } catch {
        writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }

      try {
        const response = await server.handleRequest(request);
        if (response) {
          writeMessage(response);
        }
      } catch (error) {
        logger.error({ event: "server_error", message: error?.message ?? "Unhandled error" });
        writeMessage({
          jsonrpc: "2.0",
          id: request?.id ?? null,
          error: { code: -32000, message: error?.message ?? "Unhandled server error" }
        });
      }
    });
  });

  logger.info({ event: "stdio_server_started", transport: "stdio" });
}

async function startHttpMode() {
  const httpTransport = createHttpTransport({
    config,
    mcpServer: server,
    logger,
    metrics
  });

  const shutdown = async (signal) => {
    logger.info({ event: "http_server_shutdown", signal });
    try {
      await httpTransport.close();
    } catch (error) {
      logger.error({ event: "http_server_shutdown_error", message: error?.message ?? "Shutdown failed" });
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await httpTransport.listen();

  if (config.reconciliationEnabled) {
    const timer = setInterval(() => {
      reconciliationService.reconcileOnce({ adapterTraceId: null }).catch((error) => {
        logger.error({ event: "receipt_reconciliation_error", message: error?.message ?? "Reconciliation failed" });
      });
    }, config.reconciliationIntervalMs);
    timer.unref?.();
  }
}

if (config.transportMode === "stdio") {
  startStdioTransport();
} else {
  await startHttpMode();
}
