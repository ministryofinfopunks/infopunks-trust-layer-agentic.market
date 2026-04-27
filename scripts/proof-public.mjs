#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseJsonEnv(name) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON when provided.`);
  }
}

function buildPaymentHeader(payment, challenge) {
  if (payment?.x402Version && payment?.accepted && payment?.payload) {
    return Buffer.from(JSON.stringify(payment), "utf8").toString("base64");
  }
  if (payment?.paymentPayload && payment?.paymentRequirements) {
    return Buffer.from(JSON.stringify({
      x402Version: 2,
      accepted: payment.paymentRequirements,
      payload: payment.paymentPayload.payload ?? payment.paymentPayload
    }), "utf8").toString("base64");
  }
  if (payment?.payload) {
    return Buffer.from(JSON.stringify({
      x402Version: 2,
      accepted: challenge?.accepts?.[0] ?? {},
      payload: payment.payload
    }), "utf8").toString("base64");
  }
  return null;
}

const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
const buyerPrivateKey = required("X402_TEST_BUYER_PRIVATE_KEY");
const preparedPayment = parseJsonEnv("TESTNET_X402_PAYMENT_JSON");
if (!publicBaseUrl.startsWith("https://")) {
  throw new Error("PUBLIC_BASE_URL must be HTTPS.");
}

const proofsDir = path.resolve(process.cwd(), "docs/proofs");
mkdirSync(proofsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const terminalPath = path.join(proofsDir, `terminal-proof-public-testnet-${stamp}.txt`);
const receiptPath = path.join(proofsDir, `receipt-log-public-testnet-${stamp}.json`);

const lines = [
  "# Public Testnet Proof",
  `generated_at=${new Date().toISOString()}`,
  `base_url=${publicBaseUrl}`
];

const staticChecks = [
  ["health", "/health", 200],
  ["openapi", "/openapi.json", 200],
  ["manifest", "/.well-known/infopunks-trust-layer.json", 200]
];
for (const [name, route, expected] of staticChecks) {
  const response = await fetch(`${publicBaseUrl}${route}`);
  assert.equal(response.status, expected);
  lines.push(`${name}=${response.status}`);
}

const calls = Number(process.env.PUBLIC_PROOF_CALLS ?? 3);
const receipts = [];
for (let index = 1; index <= calls; index += 1) {
  const body = {
    subject_id: `agent_public_${index}`,
    context: {
      task_type: "marketplace_routing",
      domain: "general",
      risk_level: "medium"
    }
  };

  const unpaid = await fetch(`${publicBaseUrl}/v1/resolve-trust`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(unpaid.status, 402);

  const challengeRaw = unpaid.headers.get("payment-required");
  assert.equal(typeof challengeRaw, "string");
  const challenge = JSON.parse(Buffer.from(challengeRaw, "base64").toString("utf8"));
  const fallbackPayment = {
    x402Version: 2,
    accepted: challenge?.accepts?.[0] ?? {},
    payload: {
      authorization: {
        from: `0x${buyerPrivateKey.replace(/^0x/, "").slice(-40).padStart(40, "0")}`,
        nonce: `0xproof${Date.now()}${index}`
      }
    }
  };
  const paymentHeader = buildPaymentHeader(preparedPayment ?? fallbackPayment, challenge);
  if (!paymentHeader) {
    throw new Error("Could not derive x-payment header from TESTNET_X402_PAYMENT_JSON.");
  }

  const paid = await fetch(`${publicBaseUrl}/v1/resolve-trust`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payment": paymentHeader
    },
    body: JSON.stringify(body)
  });
  assert.equal(paid.status, 200);
  const paidJson = await paid.json();
  assert.equal(paidJson?.receipt?.x402_verified, true);
  assert.equal(typeof paidJson?.receipt?.payment_receipt_id, "string");

  receipts.push({
    call: index,
    subject_id: body.subject_id,
    unpaid_status: unpaid.status,
    paid_status: paid.status,
    receipt_id: paidJson.receipt.payment_receipt_id,
    verifier_reference: paidJson.receipt.verifier_reference ?? null,
    settlement_status: paidJson.receipt.settlement_status ?? null
  });
  lines.push(`paid_call_${index}=ok receipt_id=${paidJson.receipt.payment_receipt_id}`);
}

writeFileSync(terminalPath, `${lines.join("\n")}\n`, "utf8");
writeFileSync(receiptPath, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  mode: "public-testnet",
  base_url: publicBaseUrl,
  go_gate: receipts.length >= 3,
  receipts
}, null, 2)}\n`, "utf8");

console.log(`terminal_proof=${terminalPath}`);
console.log(`receipt_log=${receiptPath}`);
