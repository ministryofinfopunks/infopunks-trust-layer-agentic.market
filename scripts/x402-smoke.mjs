#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const networkLabel = String(process.env.SMOKE_X402_NETWORK ?? "mainnet").toLowerCase();
const requiredLive = String(process.env.SMOKE_REQUIRED ?? "false").toLowerCase() === "true";

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function skip(message) {
  if (requiredLive) {
    throw new Error(message);
  }
  console.log(`SKIP ${networkLabel} x402 smoke: ${message}`);
  console.log("Set PUBLIC_BASE_URL and MAINNET_X402_PAYMENT_JSON or TESTNET_X402_PAYMENT_JSON. Set SMOKE_REQUIRED=true to fail instead of skip.");
  process.exit(0);
}

function decodePaymentRequired(header) {
  if (!header) {
    throw new Error("402 response did not include PAYMENT-REQUIRED header.");
  }
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

function buildHeaders({ requestId, paymentHeaderB64 }) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-request-id": requestId,
    "x-request-timestamp": String(Math.floor(Date.now() / 1000)),
    "idempotency-key": `${networkLabel}-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`,
    ...(paymentHeaderB64 ? { "x-payment": paymentHeaderB64 } : {})
  };
}

function paymentEnvName() {
  return networkLabel === "testnet" ? "TESTNET_X402_PAYMENT_JSON" : "MAINNET_X402_PAYMENT_JSON";
}

function normalizePaymentInput(challenge) {
  const explicitHeader = process.env.X402_PAYMENT_HEADER_B64;
  if (explicitHeader) {
    return { paymentHeaderB64: explicitHeader, bodyPayment: null };
  }

  const envName = paymentEnvName();
  const raw = process.env[envName] ?? process.env.FACILITATOR_PAYMENT_JSON;
  if (!raw) {
    skip(`${envName} is not set`);
  }
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${envName} must be valid JSON.`);
  }

  if (parsed.x402Version && parsed.accepted && parsed.payload) {
    return {
      paymentHeaderB64: Buffer.from(JSON.stringify(parsed), "utf8").toString("base64"),
      bodyPayment: null
    };
  }

  const paymentRequirements = parsed.paymentRequirements ?? parsed.accepted ?? challenge?.accepts?.[0] ?? null;
  const paymentPayload = parsed.paymentPayload ?? (parsed.payload ? parsed : null);
  return {
    paymentHeaderB64: null,
    bodyPayment: {
      rail: parsed.rail ?? "x402",
      payer: parsed.payer ?? parsed.paymentPayload?.payload?.authorization?.from ?? parsed.payload?.authorization?.from ?? null,
      nonce: parsed.nonce ?? parsed.paymentPayload?.payload?.authorization?.nonce ?? parsed.payload?.authorization?.nonce ?? null,
      asset: parsed.asset ?? paymentRequirements?.asset ?? null,
      network: parsed.network ?? paymentRequirements?.network ?? null,
      paymentPayload,
      paymentRequirements,
      ...parsed
    }
  };
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return { response, text, json: safeJsonParse(text, { raw: text }) };
}

async function main() {
  const baseUrl = String(process.env.PUBLIC_BASE_URL ?? process.env.INFOPUNKS_TRUST_API_URL ?? "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    skip("PUBLIC_BASE_URL is not set");
  }
  if (!baseUrl.startsWith("https://") && networkLabel === "mainnet") {
    throw new Error("Mainnet x402 smoke requires an HTTPS PUBLIC_BASE_URL.");
  }

  const endpoint = `${baseUrl}/v1/resolve-trust`;
  const subjectId = process.env.SMOKE_SUBJECT_ID ?? "agent_221";
  const requestId = process.env.SMOKE_REQUEST_ID ?? `${networkLabel}-smoke-${Date.now()}`;
  const baseBody = {
    subject_id: subjectId,
    context: {
      task_type: `agentic.market.${networkLabel}_smoke`,
      domain: "marketplace",
      risk_level: "medium"
    }
  };

  console.log(`== Infopunks ${networkLabel} x402 smoke ==`);
  console.log(`Endpoint: ${endpoint}`);

  const unpaid = await requestJson(endpoint, {
    method: "POST",
    headers: buildHeaders({ requestId: `${requestId}-unpaid`, paymentHeaderB64: null }),
    body: JSON.stringify(baseBody)
  });
  console.log(`unpaid_status=${unpaid.response.status}`);
  if (unpaid.response.status !== 402) {
    throw new Error(`Expected unpaid request to return 402, received ${unpaid.response.status}: ${unpaid.text}`);
  }

  const challenge = decodePaymentRequired(unpaid.response.headers.get("payment-required"));
  const accepted = challenge.accepts?.[0];
  console.log("challenge_parsed=true");
  console.log(JSON.stringify({ network: accepted?.network, asset: accepted?.asset, amount: accepted?.amount, payTo: accepted?.payTo }, null, 2));

  const { paymentHeaderB64, bodyPayment } = normalizePaymentInput(challenge);
  const paidBody = bodyPayment ? { ...baseBody, payment: bodyPayment } : baseBody;
  const paid = await requestJson(endpoint, {
    method: "POST",
    headers: buildHeaders({ requestId: `${requestId}-paid`, paymentHeaderB64 }),
    body: JSON.stringify(paidBody)
  });
  console.log(`paid_status=${paid.response.status}`);
  if (paid.response.status !== 200) {
    throw new Error(`Expected paid retry to return 200, received ${paid.response.status}: ${paid.text}`);
  }
  if (paid.json?.receipt?.x402_verified !== true) {
    throw new Error(`Paid response missing receipt.x402_verified=true: ${paid.text}`);
  }

  console.log("receipt_logged=true");
  console.log(JSON.stringify(paid.json.receipt, null, 2));
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
