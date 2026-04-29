#!/usr/bin/env node
import assert from "node:assert/strict";

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
const subjectId = process.env.SMOKE_SUBJECT_ID ?? "agent_public_smoke";
const body = {
  subject_id: subjectId,
  context: {
    task_type: "marketplace_routing",
    domain: "general",
    risk_level: "medium"
  }
};

await assertStatus(publicBaseUrl, "/health", 200);
await assertStatus(publicBaseUrl, "/openapi.json", 200);
await assertStatus(publicBaseUrl, "/.well-known/infopunks-trust-layer.json", 200);

const unpaid = await fetch(`${publicBaseUrl}/v1/resolve-trust`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});
assert.equal(unpaid.status, 402, `/v1/resolve-trust unpaid returned ${unpaid.status}`);

const challenge = decodeChallenge(unpaid.headers.get("payment-required"));

if (!xPaymentB64) {
  console.log(JSON.stringify({
    ok: true,
    checks: {
      health: 200,
      openapi: 200,
      manifest: 200,
      unpaid: 402,
      paid: "skipped"
    },
    message: "X_PAYMENT_B64 not provided; stopped after verifying the x402 challenge.",
    challenge
  }, null, 2));
  process.exit(0);
}

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

console.log(JSON.stringify({
  ok: true,
  checks: {
    health: 200,
    openapi: 200,
    manifest: 200,
    unpaid: 402,
    paid: 200
  },
  receipt: {
    x402_verified: paidJson.receipt.x402_verified,
    payment_receipt_id: paidJson.receipt.payment_receipt_id ?? null,
    verifier_reference: paidJson.receipt.verifier_reference ?? null,
    settlement_status: paidJson.receipt.settlement_status ?? null
  }
}, null, 2));
