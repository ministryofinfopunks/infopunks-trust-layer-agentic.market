import test from "node:test";
import assert from "node:assert/strict";

import { __testOnly } from "../services/mcp-adapter/src/transport/http-server.mjs";
import { loadEnv } from "../services/mcp-adapter/src/config/env.mjs";
import { X402Verifier } from "../services/mcp-adapter/src/payments/x402-verifier.mjs";

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
      x402Eip712Version: "2",
      x402FacilitatorProvider: "openfacilitator"
    },
    {
      pricing: { units: 2 },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" }
    }
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
  assert.equal(decoded.resource.extensions.bazaar.discoverable, true);
  assert.ok(decoded.resource.inputSchema);
  assert.ok(decoded.resource.outputSchema);
  assert.match(headers["x402-discovery"], /\/\.well-known\/infopunks-trust-layer\.json$/);
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
      X402_FACILITATOR_PROVIDER: null,
      X402_ACCEPTED_ASSETS: null,
      X402_SUPPORTED_NETWORKS: null
    },
    () => loadEnv()
  );

  assert.deepEqual(config.x402AcceptedAssets, ["USDC"]);
  assert.deepEqual(config.x402SupportedNetworks, ["eip155:84532"]);
  assert.equal(config.x402VerifierUrl, "https://x402.org/facilitator");
  assert.equal(config.x402FacilitatorProvider, "openfacilitator");
});

test("loadEnv validates CDP facilitator mode only when selected", () => {
  const config = withEnv(
    {
      INFOPUNKS_ENVIRONMENT: "local",
      X402_FACILITATOR_PROVIDER: "cdp",
      X402_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
      X402_NETWORK: "eip155:8453",
      X402_SCHEME: "exact",
      X402_ASSET: "USDC",
      X402_PRICE: "0.01",
      X402_PRICE_USD: null,
      X402_PAYMENT_ASSET_ADDRESS: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
      X402_PAY_TO: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
      CDP_API_KEY_ID: "placeholder-key-id",
      CDP_API_KEY_SECRET: "placeholder-secret"
    },
    () => loadEnv()
  );

  assert.equal(config.x402FacilitatorProvider, "cdp");
  assert.equal(config.x402VerifierUrl, "https://api.cdp.coinbase.com/platform/v2/x402");
  assert.equal(config.x402PaymentScheme, "exact");
  assert.equal(config.x402PricePerUnitAtomic, "10000");
});

test("loadEnv does not require CDP credentials for default OpenFacilitator mode", () => {
  const config = withEnv(
    {
      INFOPUNKS_ENVIRONMENT: "local",
      X402_FACILITATOR_PROVIDER: null,
      CDP_API_KEY_ID: null,
      CDP_API_KEY_SECRET: null,
      X402_REQUIRED_DEFAULT: "false"
    },
    () => loadEnv()
  );

  assert.equal(config.x402FacilitatorProvider, "openfacilitator");
});

test("loadEnv rejects CDP mode without CDP secrets", () => {
  assert.throws(
    () =>
      withEnv(
        {
          INFOPUNKS_ENVIRONMENT: "local",
          X402_FACILITATOR_PROVIDER: "cdp",
          X402_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
          X402_NETWORK: "eip155:8453",
          X402_SCHEME: "exact",
          X402_ASSET: "USDC",
          X402_PRICE: "0.01",
          X402_PAYMENT_ASSET_ADDRESS: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
          X402_PAY_TO: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
          CDP_API_KEY_ID: null,
          CDP_API_KEY_SECRET: null
        },
        () => loadEnv()
      ),
    /CDP_API_KEY_ID is required/i
  );
});

test("loadEnv enforces facilitator mode for deterministic payment flow", () => {
  assert.throws(
    () =>
      withEnv(
        {
          INFOPUNKS_ENVIRONMENT: "local",
          X402_VERIFIER_MODE: "strict"
        },
        () => loadEnv()
      ),
    /must be facilitator/i
  );
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

test("cdp verifier includes top-level x402Version in v2 verify payload", async (t) => {
  const originalFetch = globalThis.fetch;
  let postedBody = null;
  globalThis.fetch = async (_url, init) => {
    postedBody = JSON.parse(init?.body ?? "{}");
    return new Response(JSON.stringify({ isValid: true, verifier_reference: "vr_cdp" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const verifier = new X402Verifier({
    mode: "facilitator",
    facilitatorProvider: "cdp",
    verifierUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
    cdpApiKeyId: "test-key-id",
    cdpApiKeySecret: "test-key-secret",
    timeoutMs: 1000,
    logger: { info() {}, warn() {}, error() {} }
  });
  verifier.authHeaders = async () => ({});

  const paymentPayload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
      payTo: "0xe4E8908308a86aB43E5dEb6C0fd0F006786104c3",
      maxTimeoutSeconds: 300
    },
    payload: {
      authorization: {
        from: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
        nonce: "0xnonce_ready_test_cdp"
      }
    }
  };

  const result = await verifier.verify({
    payment: {
      rail: "x402",
      paymentPayload,
      paymentRequirements: paymentPayload.accepted
    },
    requiredUnits: 1,
    operation: "resolve_trust",
    fallbackPayer: "payer-1",
    adapterTraceId: "mcp_trc_ready_cdp",
    entitlement: null
  });

  assert.equal(postedBody.x402Version, 2);
  assert.equal(postedBody.paymentPayload.x402Version, 2);
  assert.equal(result.ok, true);
});

test("openfacilitator verifier request body is unchanged for native x402 payload", async (t) => {
  const originalFetch = globalThis.fetch;
  let postedBody = null;
  globalThis.fetch = async (_url, init) => {
    postedBody = JSON.parse(init?.body ?? "{}");
    return new Response(JSON.stringify({ isValid: true, verifier_reference: "vr_open" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const verifier = new X402Verifier({
    mode: "facilitator",
    facilitatorProvider: "openfacilitator",
    verifierUrl: "https://x402.org/facilitator",
    timeoutMs: 1000,
    logger: null
  });

  const paymentPayload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x1111111111111111111111111111111111111111",
      maxTimeoutSeconds: 300
    },
    payload: {
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        nonce: "0xnonce_ready_test_open"
      }
    }
  };

  const result = await verifier.verify({
    payment: {
      rail: "x402",
      paymentPayload,
      paymentRequirements: paymentPayload.accepted
    },
    requiredUnits: 1,
    operation: "resolve_trust",
    fallbackPayer: "payer-1",
    adapterTraceId: "mcp_trc_ready_open",
    entitlement: null
  });

  assert.equal(Object.hasOwn(postedBody, "x402Version"), false);
  assert.equal(postedBody.paymentPayload.x402Version, 2);
  assert.equal(result.ok, true);
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
