#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

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

async function startFacilitatorServer() {
  const port = await getFreePort();
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/verify") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    let raw = "";
    for await (const chunk of req) {
      raw += String(chunk);
    }
    const body = raw ? JSON.parse(raw) : {};
    const payer = body?.paymentPayload?.payload?.authorization?.from ?? "0x2222222222222222222222222222222222222222";
    const nonce = body?.paymentPayload?.payload?.authorization?.nonce ?? "0xsmoke";
    const network = body?.paymentRequirements?.network ?? "eip155:84532";
    const asset = body?.paymentRequirements?.asset ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        isValid: true,
        payer,
        nonce,
        verifier_reference: `vr_smoke_${Date.now()}`,
        settlement_status: "provisional",
        details: { network, asset }
      })
    );
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function main() {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "infopunks-smoke-"));
  const store = new AdapterStateStore({ dbPath: path.join(runtimeDir, "adapter.db") });
  const facilitator = await startFacilitatorServer();

  const verifier = new X402Verifier({
    mode: "facilitator",
    verifierUrl: facilitator.url,
    timeoutMs: 3000,
    logger: { info() {}, warn() {}, error() {} }
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
      x402VerifierMode: "facilitator"
    },
    logger: { info() {}, warn() {}, error() {} },
    metrics: { inc() {} }
  });

  const mcpServer = new McpServer({
    config: {
      adapterName: "infopunks-smoke",
      adapterVersion: "smoke",
      x402RequiredDefault: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402VerifierMode: "facilitator",
      paidRequestTimestampWindowSeconds: 120,
      callerResolutionPolicy: "lookup-only",
      entitlementTokenRequired: false,
      entitlementRequireForPaidTools: false,
      entitlementExemptTools: []
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    metrics: { inc() {} },
    rateLimiter: { hit() {} },
    entitlementService,
    subjectResolution: { resolveCaller: async () => ({ subject_id: "caller_smoke" }) },
    apiClient: { health: async () => true },
    toolHandlers: {
      resolve_trust: async ({ args }) => ({
        subject_id: args.subject_id,
        score: 77,
        band: "watch",
        confidence: 0.84,
        decision: "allow",
        reason_codes: ["smoke_verified"]
      })
    },
    tokenValidator: null,
    store,
    reconciliationService: { reconcileOnce: async () => ({ ok: true }), applySettlementEvent: async () => ({ ok: true }) }
  });
  mcpServer.warRoomFeed = createWarRoomFeed({
    store,
    config: { adapterRuntimeDir: runtimeDir, warRoomEventsFilePath: path.join(runtimeDir, "war-room-events.jsonl") },
    logger: { info() {}, warn() {}, error() {} }
  });

  const apiPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  const transport = createHttpTransport({
    config: {
      host: "127.0.0.1",
      port: apiPort,
      publicUrl: baseUrl,
      adapterVersion: "smoke",
      x402VerifierMode: "facilitator",
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"],
      x402PaymentScheme: "exact",
      x402PaymentAssetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      x402PayTo: "0x1111111111111111111111111111111111111111",
      x402PriceUsd: "0.01",
      x402PricePerUnitAtomic: "10000",
      x402PaymentTimeoutSeconds: 300,
      x402Eip712Name: "USDC",
      x402Eip712Version: "2"
    },
    mcpServer,
    logger: { info() {}, warn() {}, error() {} },
    metrics: { snapshot() { return {}; } }
  });

  await transport.listen();
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);

    const openapi = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(openapi.status, 200);
    const openapiJson = await openapi.json();
    assert.equal(Boolean(openapiJson?.paths?.["/v1/resolve-trust"]), true);
    assert.equal(Boolean(openapiJson?.paths?.["/v1/events/recent"]), true);

    const events = await fetch(`${baseUrl}/v1/events/recent`);
    assert.equal(events.status, 200);

    const body = {
      subject_id: "agent_smoke",
      context: { task_type: "smoke", domain: "marketplace", risk_level: "medium" }
    };

    const unpaid = await fetch(`${baseUrl}/v1/resolve-trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    assert.equal(unpaid.status, 402);
    const challengeRaw = unpaid.headers.get("payment-required");
    assert.equal(typeof challengeRaw, "string");
    const challenge = JSON.parse(Buffer.from(challengeRaw, "base64").toString("utf8"));
    assert.equal(Boolean(challenge?.accepts?.[0]), true);

    const paymentPayload = {
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: {
        authorization: {
          from: "0x2222222222222222222222222222222222222222",
          nonce: `0xsmoke${Date.now()}`
        }
      }
    };
    const paid = await fetch(`${baseUrl}/v1/resolve-trust`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payment": Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64")
      },
      body: JSON.stringify(body)
    });
    assert.equal(paid.status, 200);
    const paidJson = await paid.json();
    assert.equal(paidJson?.receipt?.x402_verified, true);
    assert.equal(typeof paidJson?.receipt?.payment_receipt_id, "string");

    const receipt = store.getReceiptById(paidJson.receipt.payment_receipt_id);
    assert.ok(receipt);
    assert.equal(receipt.receipt_status, "verified");
    assert.equal(receipt.tool_name, "resolve_trust");

    const recentEvents = await fetch(`${baseUrl}/v1/events/recent`);
    assert.equal(recentEvents.status, 200);
    const recentEventsJson = await recentEvents.json();
    const paidEvent = recentEventsJson.events.find((entry) =>
      entry.receipt_id === paidJson.receipt.payment_receipt_id && entry.route === "allow"
    );
    assert.ok(paidEvent);
    assert.equal(paidEvent.subject_id, body.subject_id);
    assert.equal(paidEvent.trust_score, 77);
    assert.equal(paidEvent.route, "allow");
    assert.equal(Object.hasOwn(paidEvent, "payer"), false);
  } finally {
    await transport.close();
    await facilitator.close();
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

main();
