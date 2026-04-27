#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";

import { AdapterStateStore } from "../services/mcp-adapter/src/storage/state-store.mjs";
import { EntitlementService } from "../services/mcp-adapter/src/payments/entitlements.mjs";
import { X402Verifier } from "../services/mcp-adapter/src/payments/x402-verifier.mjs";
import { McpServer } from "../services/mcp-adapter/src/transport/mcp-server.mjs";
import { createHttpTransport } from "../services/mcp-adapter/src/transport/http-server.mjs";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startFacilitator() {
  const port = await freePort();
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/verify") {
      let raw = "";
      for await (const chunk of req) {
        raw += String(chunk);
      }
      const body = raw ? JSON.parse(raw) : {};
      const payer = body?.paymentPayload?.payload?.authorization?.from ?? "0x2222222222222222222222222222222222222222";
      const nonce = body?.paymentPayload?.payload?.authorization?.nonce ?? `0xnonce_${Date.now()}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        isValid: true,
        payer,
        nonce,
        verifier_reference: `vr_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        settlement_status: "provisional"
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function appendTerminal(filePath, line) {
  appendFileSync(filePath, `${line}\n`, "utf8");
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const proofsDir = path.resolve(process.cwd(), "docs/proofs");
mkdirSync(proofsDir, { recursive: true });
const terminalPath = path.join(proofsDir, `terminal-proof-${timestamp}.txt`);
const receiptPath = path.join(proofsDir, `receipt-log-${timestamp}.json`);
const eventPath = path.join(proofsDir, `event-feed-${timestamp}.json`);

appendTerminal(terminalPath, "# Terminal Proof");
appendTerminal(terminalPath, `generated_at=${new Date().toISOString()}`);
appendTerminal(terminalPath, "verifier_mode=facilitator");

const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "infopunks-proof-"));
const store = new AdapterStateStore({ dbPath: path.join(runtimeDir, "adapter.db") });
const facilitator = await startFacilitator();

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
    adapterName: "infopunks-proof",
    adapterVersion: "proof",
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
  subjectResolution: { resolveCaller: async () => ({ subject_id: "caller_proof" }) },
  apiClient: { health: async () => true },
  toolHandlers: {
    resolve_trust: async ({ args }) => ({
      subject_id: args.subject_id,
      score: 80,
      band: "watch",
      confidence: 0.86,
      decision: "allow",
      reason_codes: ["proof_ok"]
    })
  },
  tokenValidator: null,
  store,
  reconciliationService: {
    reconcileOnce: async () => ({ ok: true }),
    applySettlementEvent: async () => ({ ok: true })
  }
});

const apiPort = await freePort();
const baseUrl = `http://127.0.0.1:${apiPort}`;
const transport = createHttpTransport({
  config: {
    host: "127.0.0.1",
    port: apiPort,
    publicUrl: baseUrl,
    adapterVersion: "proof",
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

const receipts = [];
try {
  await transport.listen();
  for (let index = 1; index <= 3; index += 1) {
    const subjectId = `agent_proof_${index}`;
    const requestBody = {
      subject_id: subjectId,
      context: { task_type: "marketplace_routing", domain: "general", risk_level: "medium" }
    };

    const unpaid = await fetch(`${baseUrl}/v1/resolve-trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    assert.equal(unpaid.status, 402);
    const challenge = JSON.parse(Buffer.from(unpaid.headers.get("payment-required"), "base64").toString("utf8"));

    const paymentPayload = {
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: {
        authorization: {
          from: `0x${String(index).padStart(40, "2")}`,
          nonce: `0xproof${Date.now()}${index}`
        }
      }
    };
    const paid = await fetch(`${baseUrl}/v1/resolve-trust`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payment": Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64")
      },
      body: JSON.stringify(requestBody)
    });
    assert.equal(paid.status, 200);
    const response = await paid.json();
    const receiptId = response?.receipt?.payment_receipt_id;
    assert.equal(typeof receiptId, "string");
    const stored = store.getReceiptById(receiptId);
    assert.ok(stored);

    appendTerminal(terminalPath, `paid_call_${index}=ok subject=${subjectId} receipt_id=${receiptId}`);
    receipts.push({
      call: index,
      subject_id: subjectId,
      unpaid_status: unpaid.status,
      paid_status: paid.status,
      receipt_id: receiptId,
      verifier_reference: response?.receipt?.verifier_reference ?? null,
      settlement_status: response?.receipt?.settlement_status ?? null,
      stored_receipt_status: stored.receipt_status,
      stored_tool: stored.tool_name
    });
  }
} finally {
  await transport.close();
  await facilitator.close();
  rmSync(runtimeDir, { recursive: true, force: true });
}

const events = receipts.map((entry) => ({
  event: "paid_call.success",
  subject_id: entry.subject_id,
  receipt_id: entry.receipt_id,
  settlement_status: entry.settlement_status
}));

writeFileSync(receiptPath, `${JSON.stringify({ generated_at: new Date().toISOString(), go_gate: receipts.length >= 3, receipts }, null, 2)}\n`);
writeFileSync(eventPath, `${JSON.stringify({ generated_at: new Date().toISOString(), events }, null, 2)}\n`);

appendTerminal(terminalPath, `go_gate=${receipts.length >= 3}`);
appendTerminal(terminalPath, `receipt_log=${receiptPath}`);
appendTerminal(terminalPath, `event_feed=${eventPath}`);

console.log(`terminal_proof=${terminalPath}`);
console.log(`receipt_log=${receiptPath}`);
console.log(`event_feed=${eventPath}`);
