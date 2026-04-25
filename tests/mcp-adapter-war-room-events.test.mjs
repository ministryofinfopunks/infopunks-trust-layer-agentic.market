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

async function startHarness(t, { verifierMode = "stub", sharedSecret = null, resolveTrustHandler } = {}) {
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
      adapterName: "infopunks-war-room-test",
      adapterVersion: "test",
      x402RequiredDefault: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402VerifierMode: verifierMode,
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

  async function postTrustScore(body) {
    const res = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return {
      status: res.status,
      payload: text ? JSON.parse(text) : null
    };
  }

  async function getWarRoomEvents() {
    const res = await fetch(`http://127.0.0.1:${port}/api/war-room/events`);
    const payload = await res.json();
    return { status: res.status, payload };
  }

  return { postTrustScore, getWarRoomEvents, store };
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
});

test("war room frontend script syntax check passes", () => {
  const result = spawnSync(process.execPath, ["--check", "apps/war-room/app.js"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
