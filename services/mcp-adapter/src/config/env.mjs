import path from "node:path";
import os from "node:os";

const ALLOWED_VERIFIER_MODES = new Set(["facilitator", "strict", "stub"]);
const ALLOWED_TRANSPORTS = new Set(["http", "stdio"]);
const ALLOWED_STATE_STORE_DRIVERS = new Set(["sqlite", "postgres"]);
const ALLOWED_IDENTITY_MAP_DRIVERS = new Set(["file", "postgres"]);
const ALLOWED_RATE_LIMIT_DRIVERS = new Set(["memory", "postgres"]);
const BASE_MAINNET_CAIP2 = "eip155:8453";
const BASE_SEPOLIA_CAIP2 = "eip155:84532";
const BASE_MAINNET_USDC = "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isProductionLike(environment) {
  return environment !== "local" && environment !== "test";
}

function isMainnetProduction(config) {
  return config.nodeEnv === "production" || config.environment === "production";
}

function requirePositiveNumber(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
}

function requireNonNegativeNumber(name, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
}

function isHexAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isZeroAddress(value) {
  return String(value ?? "").toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function normalizeX402Network(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return normalized;
  }
  if (normalized === "base") {
    return BASE_MAINNET_CAIP2;
  }
  if (normalized === "base-sepolia") {
    return BASE_SEPOLIA_CAIP2;
  }
  return normalized;
}

function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return defaultValue;
  }
  return String(raw).trim().toLowerCase() === "true";
}

function containsUnsafeProductionMarker(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.includes("localhost")
    || normalized.includes("127.0.0.1")
    || normalized.includes("::1")
    || normalized.includes("sepolia")
    || normalized.includes("mock")
    || normalized.includes("relaxed");
}

function usdToUsdcAtomic(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new Error("X402_PRICE_USD must be a positive decimal with at most 6 fractional digits.");
  }
  const [whole, fraction = ""] = raw.split(".");
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (atomic <= 0n) {
    throw new Error("X402_PRICE_USD must be greater than zero.");
  }
  return atomic.toString();
}

function defaultAdapterRuntimeDir(environment) {
  if (isNonEmptyString(process.env.MCP_ADAPTER_RUNTIME_DIR)) {
    return process.env.MCP_ADAPTER_RUNTIME_DIR.trim();
  }
  if (isNonEmptyString(process.env.DATA_DIR)) {
    return path.join(process.env.DATA_DIR.trim(), "mcp-adapter");
  }
  if (environment === "local" || environment === "test") {
    return path.resolve(process.cwd(), "services/mcp-adapter/.runtime");
  }
  return path.join(os.tmpdir(), "infopunks", "mcp-adapter");
}

function resolveInternalServiceToken() {
  if (isNonEmptyString(process.env.INFOPUNKS_INTERNAL_SERVICE_TOKEN)) {
    return {
      token: process.env.INFOPUNKS_INTERNAL_SERVICE_TOKEN,
      source: "INFOPUNKS_INTERNAL_SERVICE_TOKEN"
    };
  }
  if (isNonEmptyString(process.env.INFOPUNKS_BACKEND_API_KEY)) {
    return {
      token: process.env.INFOPUNKS_BACKEND_API_KEY,
      source: "INFOPUNKS_BACKEND_API_KEY"
    };
  }
  if (isNonEmptyString(process.env.INFOPUNKS_API_KEY)) {
    return {
      token: process.env.INFOPUNKS_API_KEY,
      source: "INFOPUNKS_API_KEY"
    };
  }
  return {
    token: "dev-infopunks-key",
    source: "default_dev_fallback"
  };
}

function validateConfig(config) {
  if (isNonEmptyString(config.x402VerifierModeRequested) && config.x402VerifierModeRequested !== "facilitator") {
    throw new Error("X402_VERIFIER_MODE must be facilitator for deterministic x402 settlement flow.");
  }

  if (!isNonEmptyString(config.backendBaseUrl)) {
    throw new Error(
      "INFOPUNKS_CORE_BASE_URL is required (or INFOPUNKS_BACKEND_URL). In Render/non-local deploys, set this to your core API public URL."
    );
  }

  let backendUrl;
  try {
    backendUrl = new URL(String(config.backendBaseUrl ?? ""));
  } catch {
    throw new Error("INFOPUNKS_CORE_BASE_URL must be a valid absolute URL (including http:// or https://).");
  }
  if (!["http:", "https:"].includes(backendUrl.protocol)) {
    throw new Error("INFOPUNKS_CORE_BASE_URL must use http:// or https://.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (isProductionLike(config.environment) && loopbackHosts.has(backendUrl.hostname.toLowerCase())) {
    throw new Error(
      "INFOPUNKS_CORE_BASE_URL cannot point to localhost/loopback in non-local environments (for example Render)."
    );
  }

  if (!ALLOWED_TRANSPORTS.has(config.transportMode)) {
    throw new Error(`MCP_ADAPTER_TRANSPORT must be one of: ${Array.from(ALLOWED_TRANSPORTS).join(", ")}.`);
  }
  if (!ALLOWED_VERIFIER_MODES.has(config.x402VerifierMode)) {
    throw new Error(`X402_VERIFIER_MODE must be one of: ${Array.from(ALLOWED_VERIFIER_MODES).join(", ")}.`);
  }
  if (!ALLOWED_STATE_STORE_DRIVERS.has(config.stateStoreDriver)) {
    throw new Error(`MCP_ADAPTER_STATE_STORE_DRIVER must be one of: ${Array.from(ALLOWED_STATE_STORE_DRIVERS).join(", ")}.`);
  }
  if (!ALLOWED_IDENTITY_MAP_DRIVERS.has(config.identityMapDriver)) {
    throw new Error(`INFOPUNKS_MCP_IDENTITY_MAP_DRIVER must be one of: ${Array.from(ALLOWED_IDENTITY_MAP_DRIVERS).join(", ")}.`);
  }
  if (!ALLOWED_RATE_LIMIT_DRIVERS.has(config.rateLimitDriver)) {
    throw new Error(`MCP_ADAPTER_RATE_LIMIT_DRIVER must be one of: ${Array.from(ALLOWED_RATE_LIMIT_DRIVERS).join(", ")}.`);
  }

  requirePositiveNumber("MCP_ADAPTER_PORT", config.port);
  requirePositiveNumber("X402_VERIFIER_TIMEOUT_MS", config.x402VerifierTimeoutMs);
  requirePositiveNumber("X402_REPLAY_WINDOW_SECONDS", config.x402ReplayWindowSeconds);
  requirePositiveNumber("INFOPUNKS_X402_DAILY_LIMIT_UNITS", config.x402DailySpendLimitUnits);
  requirePositiveNumber("X402_PAYMENT_TIMEOUT_SECONDS", config.x402PaymentTimeoutSeconds);
  requirePositiveNumber("INFOPUNKS_MCP_RATE_LIMIT_PER_MINUTE", config.adapterRateLimitPerMinute);
  requirePositiveNumber("MCP_ADAPTER_MAX_BATCH_REQUESTS", config.maxBatchRequests);
  requirePositiveNumber("MCP_ADAPTER_PAID_REQUEST_TIMESTAMP_WINDOW_SECONDS", config.paidRequestTimestampWindowSeconds);
  requirePositiveNumber("MCP_ADAPTER_UPSTREAM_ATTEMPT_TIMEOUT_MS", config.upstreamAttemptTimeoutMs);
  requireNonNegativeNumber("MCP_ADAPTER_AUTO_BOOTSTRAP_TRUST_SCORE", config.autoBootstrapTrustScore);
  requirePositiveNumber("MCP_ENTITLEMENT_MAX_TTL_SECONDS", config.entitlementMaxTtlSeconds);
  requireNonNegativeNumber("MCP_ENTITLEMENT_CLOCK_SKEW_SECONDS", config.entitlementClockSkewSeconds);
  requirePositiveNumber("X402_SETTLEMENT_WEBHOOK_MAX_SKEW_SECONDS", config.settlementWebhookMaxSkewSeconds);
  requirePositiveNumber("X402_RECONCILIATION_LOCK_TTL_SECONDS", config.reconciliationLockTtlSeconds);

  const prodLike = isProductionLike(config.environment);
  const mainnetProd = isMainnetProduction(config);

  if (mainnetProd && config.nodeEnv !== "production") {
    throw new Error("NODE_ENV=production is required for production mainnet deployment.");
  }

  if (config.x402VerifierMode === "stub" && !config.x402AllowStubMode && prodLike) {
    throw new Error("X402_VERIFIER_MODE=stub is blocked outside local/test unless X402_ALLOW_STUB_MODE=true.");
  }

  if (mainnetProd) {
    if (!isNonEmptyString(config.publicBaseUrl)) {
      throw new Error("PUBLIC_BASE_URL is required for production mainnet deployment.");
    }
    let publicUrl;
    try {
      publicUrl = new URL(config.publicBaseUrl);
    } catch {
      throw new Error("PUBLIC_BASE_URL must be a valid absolute HTTPS URL.");
    }
    if (publicUrl.protocol !== "https:") {
      throw new Error("PUBLIC_BASE_URL must use HTTPS in production.");
    }
    if (loopbackHosts.has(publicUrl.hostname.toLowerCase()) || containsUnsafeProductionMarker(config.publicBaseUrl)) {
      throw new Error("PUBLIC_BASE_URL cannot contain localhost, Sepolia, mock, or relaxed markers in production.");
    }
    if (containsUnsafeProductionMarker(config.backendBaseUrl) || containsUnsafeProductionMarker(config.x402VerifierUrl)) {
      throw new Error("Production URLs cannot contain localhost, Sepolia, mock, or relaxed markers.");
    }
    if (String(config.x402NetworkRaw ?? "").trim().toLowerCase() !== "base") {
      throw new Error("X402_NETWORK=base is required for production mainnet deployment.");
    }
    if (String(config.x402AssetRaw ?? "").trim().toUpperCase() !== "USDC") {
      throw new Error("X402_ASSET=USDC is required for production mainnet deployment.");
    }
    if (!isNonEmptyString(config.x402PriceUsd)) {
      throw new Error("X402_PRICE_USD is required for production mainnet deployment.");
    }
    if (!isNonEmptyString(config.x402PayTo)) {
      throw new Error("X402_PAY_TO is required for production mainnet deployment.");
    }
    if (!isNonEmptyString(config.x402FacilitatorUrl)) {
      throw new Error("X402_FACILITATOR_URL (or X402_VERIFIER_URL) is required for production mainnet deployment.");
    }
    if (config.allowTestnet !== false) {
      throw new Error("ALLOW_TESTNET=false is required for production mainnet deployment.");
    }
    if (config.allowRelaxedPayment !== false) {
      throw new Error("ALLOW_RELAXED_PAYMENT=false is required for production mainnet deployment.");
    }
    if (config.x402VerifierMode !== "facilitator") {
      throw new Error("Production mainnet deployment requires X402_VERIFIER_MODE=facilitator.");
    }
    if (config.x402SupportedNetworks.some((network) => network === BASE_SEPOLIA_CAIP2 || String(network).includes("sepolia"))) {
      throw new Error("Production mainnet deployment cannot include Base Sepolia/testnet networks.");
    }
    if (!config.x402SupportedNetworks.includes(BASE_MAINNET_CAIP2)) {
      throw new Error("Production mainnet deployment must support Base mainnet (eip155:8453).");
    }
    if (String(config.x402PaymentAssetAddress).toLowerCase() !== BASE_MAINNET_USDC.toLowerCase()) {
      throw new Error("Production mainnet deployment requires the Base mainnet USDC asset address.");
    }
    if (String(config.x402PaymentAssetAddress).toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase()) {
      throw new Error("Production mainnet deployment cannot use the Base Sepolia USDC asset address.");
    }
  }

  if (prodLike && config.internalServiceToken === "dev-infopunks-key") {
    throw new Error(
      "INFOPUNKS_INTERNAL_SERVICE_TOKEN must be set in non-local environments so the MCP adapter can authenticate to the core API."
    );
  }
  if (prodLike && !config.internalServiceTokenExplicitlyConfigured) {
    throw new Error(
      "INFOPUNKS_INTERNAL_SERVICE_TOKEN must be explicitly configured in non-local environments for adapter->core authentication."
    );
  }
  if (prodLike && config.internalServiceTokenSource === "INFOPUNKS_API_KEY") {
    throw new Error(
      "Use INFOPUNKS_INTERNAL_SERVICE_TOKEN (or INFOPUNKS_BACKEND_API_KEY) for adapter->core auth in non-local environments."
    );
  }

  if (config.x402RequiredDefault && config.x402VerifierMode === "facilitator" && !isNonEmptyString(config.x402VerifierUrl)) {
    throw new Error("X402_VERIFIER_URL is required when X402_REQUIRED_DEFAULT=true and X402_VERIFIER_MODE=facilitator.");
  }
  if (config.x402RequiredDefault) {
    if (!isHexAddress(config.x402PaymentAssetAddress)) {
      throw new Error("X402_PAYMENT_ASSET_ADDRESS must be a 0x-prefixed 20-byte address when x402 is required.");
    }
    const payTo = String(config.x402PayTo ?? "").trim();
    const isPlaceholder = payTo.toLowerCase() === "0x1111111111111111111111111111111111111111";
    if (isProductionLike(config.environment)) {
      if (!payTo) {
        throw new Error("X402_PAY_TO is required in non-local environments when x402 is required.");
      }
      if (isPlaceholder) {
        throw new Error("X402_PAY_TO cannot use the placeholder address in non-local environments.");
      }
    }
    if (payTo) {
      if (!isHexAddress(payTo)) {
        throw new Error("X402_PAY_TO must be a 0x-prefixed 20-byte address when provided.");
      }
      if (isZeroAddress(payTo)) {
        throw new Error("X402_PAY_TO must be a non-zero receiver address when provided.");
      }
    }
  }
  if (!/^\d+$/.test(config.x402PricePerUnitAtomic) || BigInt(config.x402PricePerUnitAtomic) <= 0n) {
    throw new Error("X402_PRICE_PER_UNIT_ATOMIC must be a positive integer string.");
  }

  if (!Array.isArray(config.x402AcceptedAssets) || config.x402AcceptedAssets.length === 0) {
    throw new Error("X402_ACCEPTED_ASSETS must include at least one asset symbol.");
  }
  if (!Array.isArray(config.x402SupportedNetworks) || config.x402SupportedNetworks.length === 0) {
    throw new Error("X402_SUPPORTED_NETWORKS must include at least one network.");
  }

  if (prodLike && config.x402VerifierMode === "strict" && !isNonEmptyString(config.x402SharedSecret)) {
    throw new Error("INFOPUNKS_X402_SHARED_SECRET is required for strict verifier mode in non-local environments.");
  }

  if (prodLike && config.entitlementTokenRequired) {
    if (!isNonEmptyString(config.entitlementIssuer)) {
      throw new Error("MCP_ENTITLEMENT_ISSUER is required when entitlement tokens are required.");
    }
    if (!isNonEmptyString(config.entitlementAudience)) {
      throw new Error("MCP_ENTITLEMENT_AUDIENCE is required when entitlement tokens are required.");
    }
  }

  const allowedAlgorithms = new Set(config.entitlementAllowedAlgorithms);
  if (prodLike && config.entitlementTokenRequired) {
    if (allowedAlgorithms.has("RS256") && !isNonEmptyString(config.entitlementPublicKeyPem)) {
      throw new Error("MCP_ENTITLEMENT_RS256_PUBLIC_KEY is required when RS256 entitlement tokens are allowed.");
    }
    if (allowedAlgorithms.has("HS256") && !isNonEmptyString(config.entitlementHmacSecret)) {
      throw new Error("MCP_ENTITLEMENT_HS256_SECRET is required when HS256 entitlement tokens are allowed.");
    }
  }

  if (prodLike && config.transportMode === "http" && config.adminEndpointsRequireToken && !isNonEmptyString(config.adminToken)) {
    throw new Error("MCP_ADAPTER_ADMIN_TOKEN is required for HTTP mode in non-local environments.");
  }

  if (prodLike && config.transportMode === "http" && config.requirePublicUrlInNonLocal && !isNonEmptyString(config.publicUrl)) {
    throw new Error(
      "MCP_ADAPTER_PUBLIC_URL is required in non-local HTTP mode for marketplace discovery correctness. Use your public adapter URL."
    );
  }

  if (
    prodLike
    && config.transportMode === "http"
    && config.requireWebhookAuthInNonLocal
    && !isNonEmptyString(config.settlementWebhookHmacSecret)
    && !isNonEmptyString(config.settlementWebhookSecret)
  ) {
    throw new Error(
      "Webhook auth is required in non-local HTTP mode. Set X402_SETTLEMENT_WEBHOOK_HMAC_SECRET or X402_SETTLEMENT_WEBHOOK_SECRET."
    );
  }

  if (config.stateStoreDriver === "postgres" && !isNonEmptyString(config.stateStoreDatabaseUrl)) {
    throw new Error("MCP_ADAPTER_STATE_STORE_DATABASE_URL is required when MCP_ADAPTER_STATE_STORE_DRIVER=postgres.");
  }
  if (config.identityMapDriver === "postgres" && !isNonEmptyString(config.identityMapDatabaseUrl ?? config.stateStoreDatabaseUrl)) {
    throw new Error(
      "INFOPUNKS_MCP_IDENTITY_MAP_DATABASE_URL (or MCP_ADAPTER_STATE_STORE_DATABASE_URL) is required when INFOPUNKS_MCP_IDENTITY_MAP_DRIVER=postgres."
    );
  }
  if (config.rateLimitDriver === "postgres" && !isNonEmptyString(config.rateLimitPostgresUrl ?? config.stateStoreDatabaseUrl)) {
    throw new Error(
      "MCP_ADAPTER_RATE_LIMIT_POSTGRES_URL (or MCP_ADAPTER_STATE_STORE_DATABASE_URL) is required when MCP_ADAPTER_RATE_LIMIT_DRIVER=postgres."
    );
  }

  if (config.multiInstanceMode) {
    if (config.stateStoreDriver !== "postgres") {
      throw new Error("MCP_ADAPTER_MULTI_INSTANCE_MODE=true requires MCP_ADAPTER_STATE_STORE_DRIVER=postgres.");
    }
    if (config.identityMapDriver !== "postgres") {
      throw new Error("MCP_ADAPTER_MULTI_INSTANCE_MODE=true requires INFOPUNKS_MCP_IDENTITY_MAP_DRIVER=postgres.");
    }
    if (config.rateLimitDriver !== "postgres") {
      throw new Error("MCP_ADAPTER_MULTI_INSTANCE_MODE=true requires MCP_ADAPTER_RATE_LIMIT_DRIVER=postgres.");
    }
  }
}

export function loadEnv() {
  const nodeEnv = process.env.NODE_ENV ?? "";
  const environment = process.env.INFOPUNKS_ENVIRONMENT ?? (nodeEnv === "production" ? "production" : "local");
  const adapterRuntimeDir = defaultAdapterRuntimeDir(environment);
  const x402VerifierModeRequested = process.env.X402_VERIFIER_MODE ?? "facilitator";
  const internalServiceTokenExplicitlyConfigured = isNonEmptyString(process.env.INFOPUNKS_INTERNAL_SERVICE_TOKEN);
  const defaultBackendBaseUrl = (environment === "local" || environment === "test")
    ? "http://127.0.0.1:4010"
    : null;
  const backendBaseUrl = (
    process.env.INFOPUNKS_CORE_BASE_URL ??
    process.env.INFOPUNKS_BACKEND_URL ??
    defaultBackendBaseUrl
  )
    ?.trim()
    .replace(/\/$/, "") ?? "";
  const { token: internalServiceToken, source: internalServiceTokenSource } = resolveInternalServiceToken();
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? process.env.MCP_ADAPTER_PUBLIC_URL ?? null;
  const x402NetworkRaw = process.env.X402_NETWORK ?? null;
  const x402AssetRaw = process.env.X402_ASSET ?? null;
  const x402PriceUsd = process.env.X402_PRICE_USD ?? null;
  const x402PriceFromUsd = usdToUsdcAtomic(x402PriceUsd);
  const x402SupportedNetworks = (x402NetworkRaw != null
    ? [normalizeX402Network(x402NetworkRaw)]
    : (process.env.X402_SUPPORTED_NETWORKS ?? BASE_SEPOLIA_CAIP2)
      .split(",")
      .map((entry) => normalizeX402Network(entry)))
    .filter(Boolean);
  const x402AcceptedAssets = (x402AssetRaw != null ? [x402AssetRaw] : (process.env.X402_ACCEPTED_ASSETS ?? "USDC").split(","))
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const x402PaymentAssetAddress = process.env.X402_PAYMENT_ASSET_ADDRESS
    ?? (x402SupportedNetworks.includes(BASE_MAINNET_CAIP2) ? BASE_MAINNET_USDC : BASE_SEPOLIA_USDC);
  const x402FacilitatorUrl = process.env.X402_FACILITATOR_URL ?? process.env.X402_VERIFIER_URL ?? null;

  const config = {
    nodeEnv,
    adapterRuntimeDir,
    transportMode: process.env.MCP_ADAPTER_TRANSPORT ?? "http",
    host: process.env.MCP_ADAPTER_HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? process.env.MCP_ADAPTER_PORT ?? 4021),
    adapterName: "infopunks-trust-mcp-adapter",
    adapterVersion: "0.3.0",
    backendBaseUrl,
    internalServiceToken,
    internalServiceTokenSource,
    internalServiceTokenExplicitlyConfigured,
    publicUrl: publicBaseUrl,
    publicBaseUrl,
    logLevel: process.env.MCP_ADAPTER_LOG_LEVEL ?? "info",
    x402VerifierModeRequested,
    x402VerifierMode: "facilitator",
    x402AllowStubMode: String(process.env.X402_ALLOW_STUB_MODE ?? "false") === "true",
    x402RequiredDefault: String(process.env.X402_REQUIRED_DEFAULT ?? "true") === "true",
    x402VerifierUrl: x402FacilitatorUrl ?? "https://x402.org/facilitator",
    x402FacilitatorUrl,
    x402VerifierApiKey: process.env.X402_VERIFIER_API_KEY ?? null,
    x402VerifierTimeoutMs: Number(process.env.X402_VERIFIER_TIMEOUT_MS ?? 5000),
    x402ReplayWindowSeconds: Number(process.env.X402_REPLAY_WINDOW_SECONDS ?? 900),
    x402ReplayStrict: String(process.env.X402_REPLAY_STRICT ?? "true") === "true",
    x402NetworkRaw,
    x402AssetRaw,
    x402PriceUsd,
    allowTestnet: parseBooleanEnv("ALLOW_TESTNET", true),
    allowRelaxedPayment: parseBooleanEnv("ALLOW_RELAXED_PAYMENT", false),
    x402AcceptedAssets,
    x402SupportedNetworks,
    x402PaymentScheme: process.env.X402_PAYMENT_SCHEME ?? "exact",
    x402PaymentAssetAddress,
    x402PayTo: process.env.X402_PAY_TO ?? "",
    x402PricePerUnitAtomic: process.env.X402_PRICE_PER_UNIT_ATOMIC ?? x402PriceFromUsd ?? "10000",
    x402PaymentTimeoutSeconds: Number(process.env.X402_PAYMENT_TIMEOUT_SECONDS ?? 300),
    x402Eip712Name: process.env.X402_EIP712_NAME ?? "USDC",
    x402Eip712Version: process.env.X402_EIP712_VERSION ?? "2",
    x402RequirePaymentAsset: String(process.env.X402_REQUIRE_PAYMENT_ASSET ?? "false") === "true",
    x402RequirePaymentNetwork: String(process.env.X402_REQUIRE_PAYMENT_NETWORK ?? "false") === "true",
    environment,
    defaultDomain: process.env.INFOPUNKS_MCP_DEFAULT_DOMAIN ?? "general",
    defaultRiskLevel: process.env.INFOPUNKS_MCP_DEFAULT_RISK_LEVEL ?? "medium",
    callerResolutionPolicy: process.env.INFOPUNKS_CALLER_RESOLUTION_POLICY ?? "lazy-register",
    targetResolutionPolicy: process.env.INFOPUNKS_TARGET_RESOLUTION_POLICY ?? "lookup-only",
    identityMapPath:
      process.env.INFOPUNKS_MCP_IDENTITY_MAP_PATH ??
      path.join(adapterRuntimeDir, "external_identity_mappings.json"),
    identityMapDriver: process.env.INFOPUNKS_MCP_IDENTITY_MAP_DRIVER ?? "file",
    stateDbPath:
      process.env.MCP_ADAPTER_STATE_DB_PATH ??
      path.join(adapterRuntimeDir, "adapter-state.db"),
    warRoomEventsFilePath:
      process.env.MCP_ADAPTER_WAR_ROOM_EVENTS_FILE ??
      path.join(adapterRuntimeDir, "war-room-events.jsonl"),
    stateStoreDriver: process.env.MCP_ADAPTER_STATE_STORE_DRIVER ?? "sqlite",
    stateStoreDatabaseUrl: process.env.MCP_ADAPTER_STATE_STORE_DATABASE_URL ?? null,
    x402SharedSecret: process.env.INFOPUNKS_X402_SHARED_SECRET ?? null,
    x402DailySpendLimitUnits: Number(process.env.INFOPUNKS_X402_DAILY_LIMIT_UNITS ?? 100),
    adapterRateLimitPerMinute: Number(process.env.INFOPUNKS_MCP_RATE_LIMIT_PER_MINUTE ?? 240),
    settlementWebhookSecret: process.env.X402_SETTLEMENT_WEBHOOK_SECRET ?? null,
    settlementWebhookHmacSecret: process.env.X402_SETTLEMENT_WEBHOOK_HMAC_SECRET ?? null,
    settlementWebhookMaxSkewSeconds: Number(process.env.X402_SETTLEMENT_WEBHOOK_MAX_SKEW_SECONDS ?? 300),
    reconciliationIntervalMs: Number(process.env.X402_RECONCILIATION_INTERVAL_MS ?? 60000),
    reconciliationEnabled: String(process.env.X402_RECONCILIATION_ENABLED ?? "true") === "true",
    reconciliationLockTtlSeconds: Number(process.env.X402_RECONCILIATION_LOCK_TTL_SECONDS ?? 90),
    adminToken: process.env.MCP_ADAPTER_ADMIN_TOKEN ?? null,
    adminEndpointsRequireToken: String(process.env.MCP_ADAPTER_REQUIRE_ADMIN_TOKEN ?? "true") === "true",
    metricsPublic: String(process.env.MCP_ADAPTER_METRICS_PUBLIC ?? "false") === "true",
    maxBatchRequests: Number(process.env.MCP_ADAPTER_MAX_BATCH_REQUESTS ?? 25),
    paidRequestTimestampWindowSeconds: Number(process.env.MCP_ADAPTER_PAID_REQUEST_TIMESTAMP_WINDOW_SECONDS ?? 120),
    upstreamAttemptTimeoutMs: Number(process.env.MCP_ADAPTER_UPSTREAM_ATTEMPT_TIMEOUT_MS ?? 2000),
    autoBootstrapUnknownSubjects: String(process.env.MCP_ADAPTER_AUTO_BOOTSTRAP_UNKNOWN_SUBJECTS ?? "true") === "true",
    autoBootstrapTrustScore: Number(process.env.MCP_ADAPTER_AUTO_BOOTSTRAP_TRUST_SCORE ?? 20),
    autoBootstrapTrustTier: process.env.MCP_ADAPTER_AUTO_BOOTSTRAP_TRUST_TIER ?? "unverified",
    rateLimitDriver: process.env.MCP_ADAPTER_RATE_LIMIT_DRIVER ?? "memory",
    rateLimitPostgresUrl: process.env.MCP_ADAPTER_RATE_LIMIT_POSTGRES_URL ?? null,
    requireWebhookAuthInNonLocal: String(process.env.MCP_ADAPTER_REQUIRE_WEBHOOK_AUTH_NON_LOCAL ?? "true") === "true",
    requirePublicUrlInNonLocal: String(process.env.MCP_ADAPTER_REQUIRE_PUBLIC_URL_NON_LOCAL ?? "true") === "true",
    multiInstanceMode: String(process.env.MCP_ADAPTER_MULTI_INSTANCE_MODE ?? "false") === "true",
    identityMapDatabaseUrl: process.env.INFOPUNKS_MCP_IDENTITY_MAP_DATABASE_URL ?? null,
    entitlementTokenRequired: String(process.env.MCP_ENTITLEMENT_TOKEN_REQUIRED ?? "false") === "true",
    entitlementRequireForPaidTools: String(process.env.MCP_ENTITLEMENT_REQUIRE_FOR_PAID_TOOLS ?? "false") === "true",
    entitlementFallbackAllow: String(process.env.MCP_ENTITLEMENT_FALLBACK_ALLOW ?? "false") === "true",
    entitlementIssuer: process.env.MCP_ENTITLEMENT_ISSUER ?? null,
    entitlementAudience: process.env.MCP_ENTITLEMENT_AUDIENCE ?? null,
    entitlementHmacSecret: process.env.MCP_ENTITLEMENT_HS256_SECRET ?? null,
    entitlementPublicKeyPem: process.env.MCP_ENTITLEMENT_RS256_PUBLIC_KEY ?? null,
    entitlementAllowedAlgorithms: (process.env.MCP_ENTITLEMENT_ALLOWED_ALGORITHMS ?? "RS256")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    entitlementExemptTools: (process.env.MCP_ENTITLEMENT_EXEMPT_TOOLS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    entitlementClockSkewSeconds: Number(process.env.MCP_ENTITLEMENT_CLOCK_SKEW_SECONDS ?? 30),
    entitlementMaxTtlSeconds: Number(process.env.MCP_ENTITLEMENT_MAX_TTL_SECONDS ?? 3600)
  };

  validateConfig(config);
  return config;
}
