import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { AdapterStateStore } from "../services/mcp-adapter/src/storage/state-store.mjs";
import { EntitlementService } from "../services/mcp-adapter/src/payments/entitlements.mjs";
import { X402Verifier } from "../services/mcp-adapter/src/payments/x402-verifier.mjs";
import { McpServer } from "../services/mcp-adapter/src/transport/mcp-server.mjs";
import { createHttpTransport } from "../services/mcp-adapter/src/transport/http-server.mjs";

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

function makeLogger() {
  const events = [];
  return {
    events,
    logger: {
      info(payload) { events.push({ level: "info", ...payload }); },
      warn(payload) { events.push({ level: "warn", ...payload }); },
      error(payload) { events.push({ level: "error", ...payload }); },
      debug(payload) { events.push({ level: "debug", ...payload }); }
    }
  };
}

function paymentTemplate(overrides = {}) {
  return {
    rail: "x402",
    payer: "payer_sim",
    units_authorized: 5,
    nonce: "nonce_sim_1",
    idempotency_key: "idem_sim_1",
    request_timestamp: Date.now(),
    ...overrides
  };
}

async function startHarness(t, {
  verifierMode = "stub",
  sharedSecret = null,
  resolveTrustHandler,
  paidWindowSeconds = 120
} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-hardening-sim-"));
  const store = new AdapterStateStore({ dbPath: path.join(dir, "adapter.db") });
  const { logger, events } = makeLogger();

  const verifier = new X402Verifier({
    mode: verifierMode,
    sharedSecret,
    logger,
    timeoutMs: 1000
  });

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
      x402VerifierMode: verifierMode
    },
    logger,
    metrics: { inc() {} }
  });

  const mcpServer = new McpServer({
    config: {
      adapterName: "infopunks-hardening-test",
      adapterVersion: "test",
      x402RequiredDefault: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402VerifierMode: verifierMode,
      paidRequestTimestampWindowSeconds: paidWindowSeconds,
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
        score: 91,
        band: "preferred",
        confidence: 0.92,
        decision: "allow",
        reason_codes: ["simulation_success"],
        mode: "verified"
      }))
    },
    tokenValidator: null,
    store,
    reconciliationService: { reconcileOnce: async () => ({ ok: true }) }
  });

  const port = await getFreePort();
  const transport = createHttpTransport({
    config: {
      host: "127.0.0.1",
      port,
      publicUrl: `http://127.0.0.1:${port}`,
      adapterName: "infopunks-hardening-test",
      adapterVersion: "test",
      x402VerifierMode: verifierMode,
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

  async function postTrustScore(body, headers = {}) {
    const res = await fetch(`http://127.0.0.1:${port}/trust-score`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: res.status, payload };
  }

  return { postTrustScore, events, store };
}

test("hardening sim: valid paid trust call", async (t) => {
  const { postTrustScore, events } = await startHarness(t);
  const response = await postTrustScore({
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "medium" },
    payment: paymentTemplate()
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.mode, "verified");
  assert.ok(response.payload.confidence >= 0.8);

  const successEvent = events.find((entry) => entry.event === "paid_call_event" && entry.status === "verified");
  assert.ok(successEvent);
});

test("hardening sim: replay attempt is rejected", async (t) => {
  const { postTrustScore, events } = await startHarness(t);

  const first = await postTrustScore({
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "medium" },
    payment: paymentTemplate({ nonce: "nonce_replay_1", idempotency_key: "idem_replay_1" })
  });
  assert.equal(first.status, 200);

  const second = await postTrustScore({
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "medium" },
    payment: paymentTemplate({ nonce: "nonce_replay_1", idempotency_key: "idem_replay_2" })
  });

  assert.equal(second.status, 409);
  assert.equal(second.payload.error.code, "REPLAY_DETECTED");

  const failedEvent = events.find((entry) => entry.event === "paid_call_event" && entry.error_code === "REPLAY_DETECTED");
  assert.ok(failedEvent);
});

test("hardening sim: broken payload fails cleanly", async (t) => {
  const { postTrustScore, events } = await startHarness(t, {
    verifierMode: "strict",
    sharedSecret: null
  });

  const response = await postTrustScore({
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "medium" },
    payment: {
      rail: "x402",
      payer: "payer_broken",
      nonce: "nonce_broken_1",
      idempotency_key: "idem_broken_1",
      request_timestamp: Date.now()
    }
  });

  assert.ok(response.status >= 400 && response.status < 500);
  assert.equal(typeof response.payload?.error?.code, "string");
  assert.ok(["PAYMENT_VERIFICATION_FAILED", "ENTITLEMENT_REQUIRED", "INVALID_INPUT"].includes(response.payload.error.code));

  const failedEvent = events.find((entry) => entry.event === "paid_call_event" && entry.status === "rejected");
  assert.ok(failedEvent);
});

test("hardening sim: delayed upstream degrades with fallback", async (t) => {
  let attempts = 0;
  const { postTrustScore } = await startHarness(t, {
    resolveTrustHandler: async ({ args }) => {
      // Simulate retry attempts before returning a degraded fallback.
      for (let index = 0; index < 3; index += 1) {
        attempts += 1;
        if (index < 2) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          continue;
        }
        return {
          subject_id: args.subject_id,
          score: 43,
          band: "watch",
          confidence: 0.35,
          decision: "allow_with_validation",
          reason_codes: ["UPSTREAM_UNAVAILABLE"],
          mode: "degraded"
        };
      }
      throw new Error("unreachable");
    }
  });

  const started = Date.now();
  const response = await postTrustScore({
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "high" },
    payment: paymentTemplate({ nonce: "nonce_slow_1", idempotency_key: "idem_slow_1" })
  });
  const elapsed = Date.now() - started;

  assert.equal(response.status, 200);
  assert.equal(response.payload.mode, "degraded");
  assert.ok(response.payload.confidence < 0.8);
  assert.ok(String(response.payload.policy?.reason ?? "").includes("UPSTREAM_UNAVAILABLE"));
  assert.ok(attempts >= 2);
  assert.ok(elapsed < 3000);
});

test("hardening sim: idempotency retry returns original and avoids duplicate billing", async (t) => {
  let handlerCalls = 0;
  const { postTrustScore, store } = await startHarness(t, {
    resolveTrustHandler: async () => {
      handlerCalls += 1;
      return {
        subject_id: "agent_001",
        score: 87,
        band: "preferred",
        confidence: 0.89,
        decision: "allow",
        reason_codes: ["idempotency_ok"],
        mode: "verified"
      };
    }
  });

  const body = {
    entity_id: "agent_001",
    context: { task_type: "market_analysis", domain: "general", risk_level: "medium" },
    payment: paymentTemplate({
      payer: "payer_idem",
      nonce: "nonce_idem_1",
      idempotency_key: "idem_key_same_payload"
    })
  };

  const first = await postTrustScore(body);
  const second = await postTrustScore(body);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.payload.entity_id, first.payload.entity_id);
  assert.equal(second.payload.trust_score, first.payload.trust_score);
  assert.equal(second.payload.mode, first.payload.mode);
  assert.equal(second.payload.policy?.route, first.payload.policy?.route);
  assert.equal(second.payload.policy?.reason, first.payload.policy?.reason);
  assert.equal(handlerCalls, 1);

  const spend = await store.spendState("payer_idem");
  assert.equal(spend.units_spent_today, 1);
});
