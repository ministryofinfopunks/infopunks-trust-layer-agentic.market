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
  assert.match(headers["x402-discovery"], /\/\.well-known\/x402-bazaar\.json$/);
});

test("challengeHeaders normalize legacy base network alias to Base Sepolia CAIP-2", () => {
  const headers = __testOnly.challengeHeaders(
    {
      publicUrl: "https://mcp.infopunks.ai",
      host: "127.0.0.1",
      port: 4021,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["base"],
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
