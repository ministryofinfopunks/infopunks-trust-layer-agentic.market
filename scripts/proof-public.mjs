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

function decodeChallenge(headerValue) {
  assert.equal(typeof headerValue, "string");
  return JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
}

async function assertStatus(baseUrl, route, expected) {
  const response = await fetch(`${baseUrl}${route}`);
  assert.equal(response.status, expected, `${route} returned ${response.status}`);
  return response;
}

const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
const xPaymentB64 = String(process.env.X_PAYMENT_B64 ?? "").trim();
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

await assertStatus(publicBaseUrl, "/health", 200);
lines.push("health=200");
await assertStatus(publicBaseUrl, "/openapi.json", 200);
lines.push("openapi=200");
await assertStatus(publicBaseUrl, "/.well-known/infopunks-trust-layer.json", 200);
lines.push("manifest=200");
await assertStatus(publicBaseUrl, "/v1/events/recent", 200);
lines.push("events_recent=200");

const body = {
  subject_id: process.env.PROOF_SUBJECT_ID ?? "agent_public_proof",
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
assert.equal(unpaid.status, 402, `/v1/resolve-trust unpaid returned ${unpaid.status}`);
const challenge = decodeChallenge(unpaid.headers.get("payment-required"));
lines.push("unpaid=402");

let receipt = null;
if (xPaymentB64) {
  const paid = await fetch(`${publicBaseUrl}/v1/resolve-trust`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payment": xPaymentB64
    },
    body: JSON.stringify(body)
  });
  assert.equal(paid.status, 200, `/v1/resolve-trust paid returned ${paid.status}`);
  const paidJson = await paid.json();
  assert.equal(paidJson?.receipt?.x402_verified, true);
  receipt = {
    subject_id: paidJson.subject_id ?? body.subject_id,
    trust_score: paidJson.trust_score ?? null,
    route: paidJson.route ?? null,
    confidence: paidJson.confidence ?? null,
    receipt_id: paidJson.receipt.payment_receipt_id ?? null,
    verifier_reference: paidJson.receipt.verifier_reference ?? null,
    settlement_status: paidJson.receipt.settlement_status ?? null,
    x402_verified: paidJson.receipt.x402_verified
  };
  lines.push(`paid=200 receipt_id=${receipt.receipt_id}`);
} else {
  lines.push("paid=skipped missing_X_PAYMENT_B64");
}

writeFileSync(terminalPath, `${lines.join("\n")}\n`, "utf8");
writeFileSync(receiptPath, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  mode: "public-testnet",
  base_url: publicBaseUrl,
  go_gate: Boolean(receipt?.x402_verified),
  challenge,
  receipt
}, null, 2)}\n`, "utf8");

console.log(`terminal_proof=${terminalPath}`);
console.log(`receipt_log=${receiptPath}`);
