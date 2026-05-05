import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { AdapterStateStore } from "../services/mcp-adapter/src/storage/state-store.mjs";
import { EntitlementService } from "../services/mcp-adapter/src/payments/entitlements.mjs";
import { X402Verifier } from "../services/mcp-adapter/src/payments/x402-verifier.mjs";
import { McpServer } from "../services/mcp-adapter/src/transport/mcp-server.mjs";
import { createHttpTransport } from "../services/mcp-adapter/src/transport/http-server.mjs";
import { createWarRoomFeed } from "../services/mcp-adapter/src/observability/war-room-feed.mjs";

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function paymentTemplate(overrides = {}) {
  return {
    rail: "x402",
    payer: "payer_war_room",
    units_authorized: 5,
    nonce: "nonce_wr_1",
    idempotency_key: "idem_wr_1",
    request_timestamp: Date.now(),
    ...overrides
  };
}

async function startHarness(
  t,
  {
    verifierMode = "stub",
    sharedSecret = null,
    resolveTrustHandler,
    facilitatorProvider = "openfacilitator",
    verifierUrl = null,
    cdpApiKeyId = null,
    cdpApiKeySecret = null
  } = {}
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-war-room-"));
  const store = new AdapterStateStore({ dbPath: path.join(dir, "adapter.db") });

  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {}
  };

  const verifier = new X402Verifier({
    mode: verifierMode,
    facilitatorProvider,
    verifierUrl,
    cdpApiKeyId,
    cdpApiKeySecret,
    sharedSecret,
    logger,
    timeoutMs: 1000
  });
  if (facilitatorProvider === "cdp") {
    verifier.authHeaders = async () => ({});
  }

  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"],
      x402RequirePaymentAsset: false,
      x402RequirePaymentNetwork: false,
      x402VerifierMode: verifierMode,
      x402FacilitatorProvider: facilitatorProvider
    },
    logger,
    metrics: { inc() {} }
  });

  const mcpServer = new McpServer({
    config: {
      adapterName: "infopunks-war-room-test",
      adapterVersion: "test",
      x402RequiredDefault: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402VerifierMode: verifierMode,
      x402FacilitatorProvider: facilitatorProvider,
      paidRequestTimestampWindowSeconds: 120,
      callerResolutionPolicy: "lookup-only",
      entitlementTokenRequired: false,
      entitlementRequireForPaidTools: false,
      entitlementExemptTools: []
    },
    logger,
    metrics: { inc() {} },
    rateLimiter: { hit() {} },
    entitlementService,
    subjectResolution: { resolveCaller: async () => ({ subject_id: "caller_1" }) },
    apiClient: { health: async () => true },
    toolHandlers: {
      resolve_trust: resolveTrustHandler ?? (async () => ({
        subject_id: "agent_001",
        score: 77,
        trust_tier: "trusted",
        confidence: 0.91,
        decision: "allow",
        reason_codes: ["simulation_success"],
        mode: "verified"
      }))
    },
    tokenValidator: null,
    store,
    reconciliationService: { reconcileOnce: async () => ({ ok: true }) }
  });
  mcpServer.warRoomFeed = createWarRoomFeed({
    store,
    config: { adapterRuntimeDir: dir, warRoomEventsFilePath: path.join(dir, "war-room-events.jsonl") },
    logger
  });

  const port = await getFreePort();
  const transport = createHttpTransport({
    config: {
      host: "127.0.0.1",
      port,
      publicUrl: `http://127.0.0.1:${port}`,
      adapterName: "infopunks-war-room-test",
      adapterVersion: "test",
      x402VerifierMode: verifierMode,
      x402FacilitatorProvider: facilitatorProvider,
      settlementWebhookHmacSecret: "whsec",
      settlementWebhookSecret: null,
      adminEndpointsRequireToken: true,
      adminToken: "admin-token",
      entitlementTokenRequired: false,
      entitlementIssuer: null,
      entitlementAudience: null,
      metricsPublic: false,
      environment: "test",
      maxBatchRequests: 25,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"],
      x402PaymentScheme: "exact",
      x402PaymentAssetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      x402PayTo: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
      x402PricePerUnitAtomic: "10000",
      x402PaymentTimeoutSeconds: 300,
      x402Eip712Name: "USDC",
      x402Eip712Version: "2"
    },
    mcpServer,
    logger,
    metrics: { snapshot() { return {}; } }
  });

  await transport.listen();

  t.after(async () => {
    await transport.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function postTrustScore(body, extraHeaders = {}) {
    const res = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return {
      status: res.status,
      payload: text ? JSON.parse(text) : null
    };
  }

  async function getWarRoomEvents() {
    const res = await fetch(`http://127.0.0.1:${port}/v1/events/recent?limit=50`);
    const payload = await res.json();
    return { status: res.status, payload };
  }

  return { postTrustScore, getWarRoomEvents, store, baseUrl: `http://127.0.0.1:${port}` };
}

test("war room feed records success and endpoint returns newest first", async (t) => {
  const { postTrustScore, getWarRoomEvents, store } = await startHarness(t);

  const response = await postTrustScore({
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "medium" },
    payment: paymentTemplate()
  });
  assert.equal(response.status, 200);

  for (let index = 0; index < 55; index += 1) {
    await store.recordWarRoomEvent({
      event_type: "paid_call.success",
      timestamp: new Date(Date.now() - (index + 1) * 1000).toISOString(),
      payer: "seed",
      subject_id: `agent_seed_${index}`,
      trust_score: 50 + (index % 10),
      status: "success",
      amount: 1
    });
  }

  const eventsResponse = await getWarRoomEvents();
  assert.equal(eventsResponse.status, 200);
  assert.equal(Array.isArray(eventsResponse.payload.events), true);
  assert.equal(eventsResponse.payload.events.length, 50);
  assert.ok(eventsResponse.payload.events[0].timestamp >= eventsResponse.payload.events[1].timestamp);
  assert.ok(eventsResponse.payload.events.some((entry) => entry.event_type === "paid_call.success"));
  assert.equal(Object.hasOwn(eventsResponse.payload.events[0], "payer"), false);
});

test("war room feed records failed payment event", async (t) => {
  const { postTrustScore, getWarRoomEvents } = await startHarness(t, {
    verifierMode: "strict",
    sharedSecret: null
  });

  const response = await postTrustScore({
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "medium" },
    payment: {
      rail: "x402",
      payer: "payer_fail",
      nonce: "nonce_fail",
      idempotency_key: "idem_fail",
      request_timestamp: Date.now()
    }
  });
  assert.equal(response.status, 402);

  const eventsResponse = await getWarRoomEvents();
  const failed = eventsResponse.payload.events.find((entry) =>
    entry.event_type === "paid_call.payment_failed"
    || entry.error_code === "PAYMENT_VERIFICATION_FAILED"
    || entry.status === "failed"
  );
  assert.ok(failed);
  assert.ok(["failed", "rejected"].includes(failed.status));
  assert.equal(failed.facilitator_provider, "openfacilitator");
  assert.equal(failed.network, "eip155:84532");
  assert.equal(failed.payTo, "0x4cC773d286E5aA52591E9E6ebed062cC057C441E");
  assert.equal(failed.price, "10000");
  assert.ok(failed.x402_diagnostics);
  assert.ok(typeof failed.x402_diagnostics.selected_payment_header === "string");
  assert.equal(Array.isArray(failed.x402_diagnostics.verify_requirement_keys), true);
  assert.equal(failed.x402_diagnostics.has_maxAmountRequired, true);
  assert.equal(failed.x402_diagnostics.facilitator_provider, "openfacilitator");
  assert.equal(Object.hasOwn(failed.x402_diagnostics, "paymentPayload"), false);
  assert.equal(Object.hasOwn(failed.x402_diagnostics, "signature"), false);
  assert.equal(Object.hasOwn(failed.x402_diagnostics, "payment_signature"), false);
  const serializedDiagnostics = JSON.stringify(failed.x402_diagnostics).toLowerCase();
  assert.equal(serializedDiagnostics.includes("private_key"), false);
  assert.equal(serializedDiagnostics.includes("cdp_api_key"), false);
});

test("war room feed includes safe cdp verify error details and accepted comparisons", async (t) => {
  const originalFetch = globalThis.fetch;
  const verifierUrl = "https://api.cdp.coinbase.com/platform/v2/x402";
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/verify")) {
      return new Response(
        JSON.stringify({
          correlationId: "corr_test_402_1",
          errorLink: "https://docs.cdp.coinbase.com/x402/errors#invalid-payment",
          errorMessage: "Invalid payment payload.",
          errorType: "INVALID_PAYMENT"
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" }
        }
      );
    }
    return originalFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { postTrustScore, getWarRoomEvents, baseUrl } = await startHarness(t, {
    verifierMode: "facilitator",
    facilitatorProvider: "cdp",
    verifierUrl,
    cdpApiKeyId: "test-key-id",
    cdpApiKeySecret: "test-key-secret"
  });

  const decodedPaymentPayload = {
    x402Version: 2,
    payload: {
      authorization: {
        from: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
        nonce: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      signature: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    resource: `${baseUrl}/v1/resolve-trust`,
    accepted: {
      scheme: "exact",
      network: "eip155:84532",
      maxAmountRequired: "10000",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
      resource: `${baseUrl}/v1/resolve-trust`
    }
  };
  const xPayment = Buffer.from(JSON.stringify(decodedPaymentPayload), "utf8").toString("base64");

  const response = await postTrustScore(
    {
      entity_id: "agent_001",
      context: { task_type: "market_analysis", domain: "general", risk_level: "medium" }
    },
    {
      "x-payment": xPayment
    }
  );
  assert.equal(response.status, 402);

  const eventsResponse = await getWarRoomEvents();
  const failed = eventsResponse.payload.events.find((entry) =>
    entry.event_type === "paid_call.payment_failed"
    || entry.error_code === "PAYMENT_VERIFICATION_FAILED"
    || entry.status === "failed"
  );
  assert.ok(failed?.x402_diagnostics);
  const diagnostics = failed.x402_diagnostics;
  assert.equal(diagnostics.facilitator_provider, "cdp");
  assert.equal(diagnostics.facilitator_verify_status, 400);
  assert.deepEqual(diagnostics.facilitator_verify_body_keys.sort(), ["correlationId", "errorLink", "errorMessage", "errorType"]);
  assert.equal(diagnostics.facilitator_error_type, "INVALID_PAYMENT");
  assert.equal(diagnostics.facilitator_error_message, "Invalid payment payload.");
  assert.equal(diagnostics.facilitator_correlation_id, "corr_test_402_1");
  assert.equal(diagnostics.facilitator_error_link, "https://docs.cdp.coinbase.com/x402/errors#invalid-payment");
  assert.equal(Array.isArray(diagnostics.payment_accepted_keys), true);
  assert.equal(diagnostics.payment_accepted_has_amount, true);
  assert.equal(diagnostics.payment_accepted_has_maxAmountRequired, true);
  assert.equal(diagnostics.payment_accepted_amount, "10000");
  assert.equal(diagnostics.payment_accepted_maxAmountRequired, "10000");
  assert.equal(diagnostics.payment_accepted_resource, `${baseUrl}/v1/resolve-trust`);
  assert.equal(diagnostics.payment_accepted_network, "eip155:84532");
  assert.equal(diagnostics.payment_accepted_asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  assert.equal(diagnostics.payment_accepted_payTo, "0x4cC773d286E5aA52591E9E6ebed062cC057C441E");
  assert.equal(diagnostics.payment_accepted_scheme, "exact");
  assert.equal(diagnostics.accepted_resource_matches_verify_resource, true);
  assert.equal(diagnostics.accepted_network_matches_verify_network, true);
  assert.equal(diagnostics.accepted_asset_matches_verify_asset, true);
  assert.equal(diagnostics.accepted_payTo_matches_verify_payTo, true);
  assert.equal(diagnostics.accepted_amount_matches_verify_price, true);
  assert.equal(diagnostics.accepted_maxAmountRequired_matches_verify_price, true);
  assert.deepEqual(diagnostics.cdp_payment_payload_keys.sort(), ["accepted", "extensions", "payload", "resource", "x402Version"]);
  assert.equal(diagnostics.cdp_payment_payload_has_accepted, true);
  assert.equal(diagnostics.cdp_payment_payload_has_payload, true);
  assert.equal(diagnostics.cdp_payment_payload_has_resource, true);
  assert.equal(diagnostics.cdp_payment_payload_resource_type, "object");
  assert.ok(Array.isArray(diagnostics.cdp_payment_payload_accepted_keys));
  assert.equal(diagnostics.cdp_payment_payload_accepted_has_amount, true);
  assert.equal(diagnostics.cdp_payment_payload_accepted_has_maxAmountRequired, false);
  assert.equal(diagnostics.cdp_payment_payload_source, "normalized_from_wrapper");
  assert.equal(Array.isArray(diagnostics.cdp_payment_requirements_keys), true);
  assert.equal(diagnostics.cdp_payment_requirements_keys.includes("scheme"), true);
  assert.equal(diagnostics.cdp_payment_requirements_keys.includes("network"), true);
  assert.equal(diagnostics.cdp_payment_requirements_keys.includes("amount"), true);
  assert.equal(diagnostics.cdp_payment_requirements_keys.includes("asset"), true);
  assert.equal(diagnostics.cdp_payment_requirements_keys.includes("payTo"), true);
  assert.equal(diagnostics.cdp_payment_requirements_keys.includes("resource"), true);
  assert.equal(diagnostics.cdp_payment_requirements_has_amount, true);
  assert.equal(diagnostics.cdp_payment_requirements_has_maxAmountRequired, false);
  assert.equal(diagnostics.cdp_payment_requirements_amount, "10000");
  assert.equal(diagnostics.cdp_payment_requirements_resource, `${baseUrl}/v1/resolve-trust`);
  assert.equal(diagnostics.cdp_payment_requirements_source, "normalized_for_cdp");
  assert.equal(Object.hasOwn(diagnostics, "paymentPayload"), false);
  assert.equal(Object.hasOwn(diagnostics, "signature"), false);
  assert.equal(Object.hasOwn(diagnostics, "payment_signature"), false);
  const serializedDiagnostics = JSON.stringify(diagnostics).toLowerCase();
  assert.equal(serializedDiagnostics.includes("private_key"), false);
  assert.equal(serializedDiagnostics.includes("cdp_api_key"), false);
  assert.equal(serializedDiagnostics.includes("\"authorization\""), false);
  assert.equal(serializedDiagnostics.includes(xPayment.toLowerCase()), false);
});

test("war room frontend script syntax check passes", () => {
  const result = spawnSync(process.execPath, ["--check", "apps/war-room/app.js"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
