#!/usr/bin/env node
import assert from "node:assert/strict";

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

function base64FromPayment(payment, challenge) {
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

const subjectId = process.env.SMOKE_SUBJECT_ID ?? "agent_public_smoke";
const body = {
  subject_id: subjectId,
  context: {
    task_type: "marketplace_routing",
    domain: "general",
    risk_level: "medium"
  }
};

const health = await fetch(`${publicBaseUrl}/health`);
assert.equal(health.status, 200);

const openapi = await fetch(`${publicBaseUrl}/openapi.json`);
assert.equal(openapi.status, 200);

const manifest = await fetch(`${publicBaseUrl}/.well-known/infopunks-trust-layer.json`);
assert.equal(manifest.status, 200);

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
      nonce: `0xsmoke${Date.now()}`
    }
  }
};
const paymentHeader = base64FromPayment(preparedPayment ?? fallbackPayment, challenge);
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
    payment_receipt_id: paidJson.receipt.payment_receipt_id
  }
}, null, 2));
