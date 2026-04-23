import path from "node:path";

const ALLOWED_VERIFIER_MODES = new Set(["facilitator", "strict", "stub"]);
const ALLOWED_TRANSPORTS = new Set(["http", "stdio"]);
const ALLOWED_STATE_STORE_DRIVERS = new Set(["sqlite", "postgres"]);
const ALLOWED_IDENTITY_MAP_DRIVERS = new Set(["file", "postgres"]);
const ALLOWED_RATE_LIMIT_DRIVERS = new Set(["memory", "postgres"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isProductionLike(environment) {
  return environment !== "local" && environment !== "test";
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
  if (normalized === "base" || normalized === "base-sepolia") {
    return "eip155:84532";
  }
  return normalized;
}

function validateConfig(config) {
  if (!isNonEmptyString(config.backendBaseUrl)) {
    throw new Error("INFOPUNKS_CORE_BASE_URL is required (or INFOPUNKS_BACKEND_URL).");
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
    throw new Error("INFOPUNKS_CORE_BASE_URL cannot point to localhost/loopback in non-local environments.");
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
  requirePositiveNumber("MCP_ENTITLEMENT_MAX_TTL_SECONDS", config.entitlementMaxTtlSeconds);
  requireNonNegativeNumber("MCP_ENTITLEMENT_CLOCK_SKEW_SECONDS", config.entitlementClockSkewSeconds);
  requirePositiveNumber("X402_SETTLEMENT_WEBHOOK_MAX_SKEW_SECONDS", config.settlementWebhookMaxSkewSeconds);
  requirePositiveNumber("X402_RECONCILIATION_LOCK_TTL_SECONDS", config.reconciliationLockTtlSeconds);

  const prodLike = isProductionLike(config.environment);

  if (config.x402VerifierMode === "stub" && !config.x402AllowStubMode && prodLike) {
    throw new Error("X402_VERIFIER_MODE=stub is blocked outside local/test unless X402_ALLOW_STUB_MODE=true.");
  }

  if (prodLike && config.internalServiceToken === "dev-infopunks-key") {
    throw new Error("INFOPUNKS_INTERNAL_SERVICE_TOKEN must be set in non-local environments.");
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
    throw new Error("MCP_ADAPTER_PUBLIC_URL is required in non-local HTTP mode for marketplace/discovery correctness.");
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
  const environment = process.env.INFOPUNKS_ENVIRONMENT ?? "local";
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
  const internalServiceToken =
    process.env.INFOPUNKS_INTERNAL_SERVICE_TOKEN ??
    process.env.INFOPUNKS_BACKEND_API_KEY ??
    process.env.INFOPUNKS_API_KEY ??
    "dev-infopunks-key";

  const config = {
    transportMode: process.env.MCP_ADAPTER_TRANSPORT ?? "http",
    host: process.env.MCP_ADAPTER_HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? process.env.MCP_ADAPTER_PORT ?? 4021),
    adapterName: "infopunks-trust-mcp-adapter",
    adapterVersion: "0.3.0",
    backendBaseUrl,
    internalServiceToken,
    publicUrl: process.env.MCP_ADAPTER_PUBLIC_URL ?? null,
    logLevel: process.env.MCP_ADAPTER_LOG_LEVEL ?? "info",
    x402VerifierMode: process.env.X402_VERIFIER_MODE ?? "facilitator",
    x402AllowStubMode: String(process.env.X402_ALLOW_STUB_MODE ?? "false") === "true",
    x402RequiredDefault: String(process.env.X402_REQUIRED_DEFAULT ?? "true") === "true",
    x402VerifierUrl: process.env.X402_VERIFIER_URL ?? "https://x402.org/facilitator",
    x402VerifierApiKey: process.env.X402_VERIFIER_API_KEY ?? null,
    x402VerifierTimeoutMs: Number(process.env.X402_VERIFIER_TIMEOUT_MS ?? 5000),
    x402ReplayWindowSeconds: Number(process.env.X402_REPLAY_WINDOW_SECONDS ?? 900),
    x402ReplayStrict: String(process.env.X402_REPLAY_STRICT ?? "true") === "true",
    x402AcceptedAssets: (process.env.X402_ACCEPTED_ASSETS ?? "USDC")
      .split(",")
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean),
    x402SupportedNetworks: (process.env.X402_SUPPORTED_NETWORKS ?? "eip155:84532")
      .split(",")
      .map((entry) => normalizeX402Network(entry))
      .filter(Boolean),
    x402PaymentScheme: process.env.X402_PAYMENT_SCHEME ?? "exact",
    x402PaymentAssetAddress: process.env.X402_PAYMENT_ASSET_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    x402PayTo: process.env.X402_PAY_TO ?? "",
    x402PricePerUnitAtomic: process.env.X402_PRICE_PER_UNIT_ATOMIC ?? "10000",
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
      path.resolve(process.cwd(), "services/mcp-adapter/.runtime/external_identity_mappings.json"),
    identityMapDriver: process.env.INFOPUNKS_MCP_IDENTITY_MAP_DRIVER ?? "file",
    stateDbPath:
      process.env.MCP_ADAPTER_STATE_DB_PATH ??
      path.resolve(process.cwd(), "services/mcp-adapter/.runtime/adapter-state.db"),
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
    rateLimitDriver: process.env.MCP_ADAPTER_RATE_LIMIT_DRIVER ?? "memory",
    rateLimitPostgresUrl: process.env.MCP_ADAPTER_RATE_LIMIT_POSTGRES_URL ?? null,
    requireWebhookAuthInNonLocal: String(process.env.MCP_ADAPTER_REQUIRE_WEBHOOK_AUTH_NON_LOCAL ?? "true") === "true",
    requirePublicUrlInNonLocal: String(process.env.MCP_ADAPTER_REQUIRE_PUBLIC_URL_NON_LOCAL ?? "true") === "true",
    multiInstanceMode: String(process.env.MCP_ADAPTER_MULTI_INSTANCE_MODE ?? "false") === "true",
    identityMapDatabaseUrl: process.env.INFOPUNKS_MCP_IDENTITY_MAP_DATABASE_URL ?? null,
    entitlementTokenRequired: String(process.env.MCP_ENTITLEMENT_TOKEN_REQUIRED ?? "true") === "true",
    entitlementRequireForPaidTools: String(process.env.MCP_ENTITLEMENT_REQUIRE_FOR_PAID_TOOLS ?? "true") === "true",
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
