import test from "node:test";
import assert from "node:assert/strict";

import { __testOnly } from "../services/mcp-adapter/src/transport/http-server.mjs";
import { loadEnv } from "../services/mcp-adapter/src/config/env.mjs";

function withEnv(overrides, fn) {
  const snapshot = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    snapshot.set(key, process.env[key]);
    if (value === null || value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of snapshot.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("statusFromAdapterErrorCode maps payment errors to 402/409", () => {
  assert.equal(__testOnly.statusFromAdapterErrorCode("ENTITLEMENT_REQUIRED"), 402);
  assert.equal(__testOnly.statusFromAdapterErrorCode("PAYMENT_VERIFICATION_FAILED"), 402);
  assert.equal(__testOnly.statusFromAdapterErrorCode("PAYMENT_REPLAY_DETECTED"), 409);
  assert.equal(__testOnly.statusFromAdapterErrorCode("REPLAY_DETECTED"), 409);
  assert.equal(__testOnly.statusFromAdapterErrorCode("IDEMPOTENCY_CONFLICT"), 409);
  assert.equal(__testOnly.statusFromAdapterErrorCode("REQUEST_TIMESTAMP_INVALID"), 400);
});

test("challengeHeaders include discovery, pricing and payment rails", () => {
  const headers = __testOnly.challengeHeaders(
    {
      publicUrl: "https://mcp.infopunks.ai",
      host: "127.0.0.1",
      port: 4021,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"],
      x402PaymentScheme: "exact",
      x402PaymentAssetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      x402PayTo: "0x1111111111111111111111111111111111111111",
      x402PricePerUnitAtomic: "10000",
      x402PaymentTimeoutSeconds: 300,
      x402Eip712Name: "USD Coin",
      x402Eip712Version: "2"
    },
    { pricing: { units: 2 } }
  );

  assert.equal(headers["x402-required"], "true");
  assert.equal(headers["x402-pricing-units"], "2");
  assert.equal(headers["x402-payment-rail"], "x402");
  assert.equal(headers["x402-accepted-assets"], "USDC");
  assert.equal(headers["x402-supported-networks"], "eip155:84532");
  assert.equal(typeof headers["PAYMENT-REQUIRED"], "string");
  const decoded = JSON.parse(Buffer.from(headers["PAYMENT-REQUIRED"], "base64").toString("utf8"));
  assert.equal(decoded.accepts[0].network, "eip155:84532");
  assert.equal(decoded.accepts[0].asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  assert.equal(decoded.accepts[0].extra.name, "USDC");
  assert.equal(decoded.accepts[0].extra.version, "2");
  assert.match(headers["x402-discovery"], /\/\.well-known\/x402-bazaar\.json$/);
});

test("challengeHeaders normalize base network alias to Base mainnet CAIP-2", () => {
  const headers = __testOnly.challengeHeaders(
    {
      publicUrl: "https://mcp.infopunks.ai",
      host: "127.0.0.1",
      port: 4021,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["base"],
      x402PaymentScheme: "exact",
      x402PaymentAssetAddress: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
      x402PayTo: "0x1111111111111111111111111111111111111111",
      x402PricePerUnitAtomic: "10000",
      x402PaymentTimeoutSeconds: 300
    },
    { pricing: { units: 1 } }
  );

  assert.equal(headers["x402-supported-networks"], "eip155:8453");
});

test("challengeHeaders keep explicit Base Sepolia alias for testnet proof", () => {
  const headers = __testOnly.challengeHeaders(
    {
      publicUrl: "https://mcp.infopunks.ai",
      host: "127.0.0.1",
      port: 4021,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["base-sepolia"],
      x402PaymentScheme: "exact",
      x402PaymentAssetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      x402PayTo: "0x1111111111111111111111111111111111111111",
      x402PricePerUnitAtomic: "10000",
      x402PaymentTimeoutSeconds: 300
    },
    { pricing: { units: 1 } }
  );

  assert.equal(headers["x402-supported-networks"], "eip155:84532");
});

test("trust-score helper mapping emits commercial response format", () => {
  const request = __testOnly.normalizeTrustScoreRequest({
    entity_id: "agent_221",
    context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
  });
  const response = __testOnly.toTrustScoreResponse(request, {
    result: {
      score: 67,
      band: "watch",
      confidence: 0.79,
      decision: "allow_with_validation",
      reason_codes: ["recent_validator_reversal"],
      recommended_validators: [{ subject_id: "agent_784" }],
      expires_at: "2026-04-17T08:14:04Z"
    }
  });

  assert.equal(response.entity_id, "agent_221");
  assert.equal(response.trust_score, 67);
  assert.equal(response.risk_level, "medium");
  assert.equal(response.policy.route, "degrade");
  assert.equal(response.last_updated, "2026-04-17T08:14:04Z");
  assert.ok(Array.isArray(response.signals));
});

test("v1 resolve-trust response exposes Agentic.Market receipt contract", () => {
  const request = __testOnly.normalizeTrustScoreRequest({
    subject_id: "agent_221",
    context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
  });
  const response = __testOnly.toResolveTrustV1Response(
    request,
    {
      result: {
        subject_id: "agent_221",
        score: 67,
        band: "watch",
        confidence: 0.79,
        decision: "allow_with_validation",
        reason_codes: ["recent_validator_reversal"]
      },
      meta: {
        payment_receipt_id: "xrc_test",
        x402_receipt: {
          verifier_reference: "vr_test",
          settlement_status: "provisional",
          network: "eip155:8453",
          asset: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913"
        }
      }
    },
    {
      x402SupportedNetworks: ["eip155:8453"],
      x402PaymentAssetAddress: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913"
    }
  );

  assert.equal(response.subject_id, "agent_221");
  assert.equal(response.trust_score, 67);
  assert.equal(response.risk_level, "medium");
  assert.equal(response.route, "degrade");
  assert.deepEqual(response.reasons, ["recent_validator_reversal"]);
  assert.equal(response.receipt.x402_verified, true);
  assert.equal(response.receipt.network, "eip155:8453");
  assert.equal(response.receipt.asset, "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913");
});

test("loadEnv parses payment asset/network listing metadata defaults", () => {
  const config = withEnv(
    {
      INFOPUNKS_ENVIRONMENT: "local",
      X402_REQUIRED_DEFAULT: "false",
      X402_ACCEPTED_ASSETS: null,
      X402_SUPPORTED_NETWORKS: null
    },
    () => loadEnv()
  );

  assert.deepEqual(config.x402AcceptedAssets, ["USDC"]);
  assert.deepEqual(config.x402SupportedNetworks, ["eip155:84532"]);
  assert.equal(config.x402VerifierUrl, "https://x402.org/facilitator");
});

test("loadEnv requires explicit core base URL outside local/test", () => {
  assert.throws(
    () =>
      withEnv(
        {
          INFOPUNKS_ENVIRONMENT: "production",
          INFOPUNKS_CORE_BASE_URL: null,
          INFOPUNKS_BACKEND_URL: null
        },
        () => loadEnv()
      ),
    /INFOPUNKS_CORE_BASE_URL is required/
  );
});

test("loadEnv rejects localhost core URL in non-local environments", () => {
  assert.throws(
    () =>
      withEnv(
        {
          INFOPUNKS_ENVIRONMENT: "production",
          INFOPUNKS_CORE_BASE_URL: "http://127.0.0.1:4010"
        },
        () => loadEnv()
      ),
    /cannot point to localhost\/loopback/i
  );
});

test("loadEnv requires explicit INFOPUNKS_INTERNAL_SERVICE_TOKEN in non-local environments", () => {
  assert.throws(
    () =>
      withEnv(
        {
          NODE_ENV: "production",
          INFOPUNKS_ENVIRONMENT: "production",
          PUBLIC_BASE_URL: "https://mcp.infopunks.ai",
          INFOPUNKS_CORE_BASE_URL: "https://infopunks-core-api.onrender.com",
          INFOPUNKS_INTERNAL_SERVICE_TOKEN: null,
          INFOPUNKS_BACKEND_API_KEY: "some-token",
          MCP_ADAPTER_ADMIN_TOKEN: "admin-token",
          X402_FACILITATOR_URL: "https://verifier.example.com",
          X402_NETWORK: "base",
          X402_ASSET: "USDC",
          X402_PRICE_USD: "0.01",
          X402_PAYMENT_ASSET_ADDRESS: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
          X402_PAY_TO: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
          ALLOW_TESTNET: "false",
          ALLOW_RELAXED_PAYMENT: "false",
          X402_SETTLEMENT_WEBHOOK_HMAC_SECRET: "whsec",
          MCP_ENTITLEMENT_ISSUER: "agentic.market",
          MCP_ENTITLEMENT_AUDIENCE: "infopunks-mcp",
          MCP_ENTITLEMENT_RS256_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh...\n-----END PUBLIC KEY-----"
        },
        () => loadEnv()
      ),
    /must be explicitly configured/i
  );
});

test("loadEnv places local adapter runtime defaults under DATA_DIR when provided", () => {
  const config = withEnv(
    {
      INFOPUNKS_ENVIRONMENT: "local",
      DATA_DIR: "/tmp/infopunks-test-data",
      MCP_ADAPTER_STATE_DB_PATH: null,
      INFOPUNKS_MCP_IDENTITY_MAP_PATH: null
    },
    () => loadEnv()
  );

  assert.equal(config.stateDbPath, "/tmp/infopunks-test-data/mcp-adapter/adapter-state.db");
  assert.equal(config.identityMapPath, "/tmp/infopunks-test-data/mcp-adapter/external_identity_mappings.json");
});
