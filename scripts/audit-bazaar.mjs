#!/usr/bin/env node
import { randomUUID } from "node:crypto";

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function assertCheck(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const json = safeJsonParse(text, null);
  return { response, text, json };
}

function decodePaymentRequired(headerValue) {
  assertCheck(typeof headerValue === "string" && headerValue.trim(), "Missing PAYMENT-REQUIRED header on 402 response.");
  return safeJsonParse(Buffer.from(headerValue, "base64").toString("utf8"), null);
}

function decodePaymentSignatureHeader(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return null;
  }
  return safeJsonParse(Buffer.from(headerValue, "base64").toString("utf8"), null);
}

function paymentEnvName() {
  const network = String(process.env.SMOKE_X402_NETWORK ?? "mainnet").toLowerCase();
  return network === "testnet" ? "TESTNET_X402_PAYMENT_JSON" : "MAINNET_X402_PAYMENT_JSON";
}

function normalizePaymentInput(challenge) {
  const explicitHeader = process.env.X402_PAYMENT_HEADER_B64;
  if (explicitHeader) {
    return { paymentHeaderB64: explicitHeader, bodyPayment: null };
  }

  const envName = paymentEnvName();
  const raw = process.env[envName] ?? process.env.FACILITATOR_PAYMENT_JSON;
  assertCheck(Boolean(raw), `${envName} or FACILITATOR_PAYMENT_JSON must be set for paid audit checks.`);
  const parsed = safeJsonParse(raw, null);
  assertCheck(parsed && typeof parsed === "object", `${envName} must be valid JSON.`);

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

function classifyMerchantLookup(payload, statusCode) {
  const resources = Array.isArray(payload?.resources) ? payload.resources : (Array.isArray(payload?.items) ? payload.items : []);
  if (resources.length > 0) {
    return "indexed";
  }
  const errorType = String(payload?.errorType ?? "").toLowerCase();
  const errorMessage = String(payload?.errorMessage ?? "").toLowerCase();
  if (statusCode === 404 || errorType === "not_found" || errorMessage.includes("no active resources")) {
    return "not_indexed";
  }
  if (resources.length === 0) {
    return "not_indexed";
  }
  return "unknown";
}

async function main() {
  const baseUrl = String(process.env.PUBLIC_BASE_URL ?? process.env.INFOPUNKS_TRUST_API_URL ?? "").trim().replace(/\/$/, "");
  assertCheck(baseUrl, "PUBLIC_BASE_URL (or INFOPUNKS_TRUST_API_URL) is required.");

  const endpoint = `${baseUrl}/v1/resolve-trust`;
  const baseBody = {
    subject_id: process.env.SMOKE_SUBJECT_ID ?? "agent_bazaar_audit",
    context: {
      task_type: "agentic.market.bazaar_audit",
      domain: "marketplace",
      risk_level: "medium"
    }
  };
  const requestIdPrefix = `bazaar-audit-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const unpaidValid = await request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": `${requestIdPrefix}-unpaid-valid` },
    body: JSON.stringify(baseBody)
  });
  assertCheck(unpaidValid.response.status === 402, `unpaid valid body expected 402, received ${unpaidValid.response.status}`);

  const unpaidEmpty = await request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": `${requestIdPrefix}-unpaid-empty` },
    body: JSON.stringify({})
  });
  assertCheck(unpaidEmpty.response.status === 402, `unpaid empty body expected 402, received ${unpaidEmpty.response.status}`);

  const unpaidNoBody = await request(endpoint, {
    method: "POST",
    headers: { "x-request-id": `${requestIdPrefix}-unpaid-nobody` }
  });
  assertCheck(unpaidNoBody.response.status === 402, `unpaid no body expected 402, received ${unpaidNoBody.response.status}`);

  const challenge = decodePaymentRequired(unpaidValid.response.headers.get("payment-required"));
  const challengePaymentRequirement = challenge?.accepts?.[0] ?? null;
  const bazaarExtension = challenge?.resource?.extensions?.bazaar ?? null;
  const requirementBazaarExtension = challengePaymentRequirement?.resource?.extensions?.bazaar ?? null;
  assertCheck(Boolean(bazaarExtension), "402 challenge must include resource.extensions.bazaar.");
  assertCheck(Boolean(requirementBazaarExtension), "402 challenge must include accepts[0].resource.extensions.bazaar.");
  assertCheck(
    challengePaymentRequirement?.resource?.resource === challenge?.resource?.resource,
    "402 challenge accepts[0].resource.resource must match challenge.resource.resource."
  );

  const bazaarInput = requirementBazaarExtension?.info?.input ?? {};
  assertCheck(bazaarInput?.type === "http", "extensions.bazaar.info.input.type must be http.");
  assertCheck(bazaarInput?.method === "POST", "extensions.bazaar.info.input.method must be POST.");
  assertCheck(
    bazaarInput?.path === "/v1/resolve-trust" || requirementBazaarExtension?.routeTemplate === "/v1/resolve-trust",
    "extensions.bazaar must include input.path or routeTemplate for /v1/resolve-trust."
  );
  assertCheck(bazaarInput?.contentType === "application/json", "extensions.bazaar.info.input.contentType must be application/json.");
  assertCheck(typeof bazaarInput?.body?.subject_id === "string" && bazaarInput.body.subject_id.length > 0, "extensions.bazaar.info.input.body.subject_id must be a non-empty string.");
  assertCheck(
    bazaarInput?.body?.context && typeof bazaarInput.body.context === "object" && !Array.isArray(bazaarInput.body.context),
    "extensions.bazaar.info.input.body.context must be an object."
  );
  const bazaarOutput = requirementBazaarExtension?.info?.output ?? {};
  assertCheck(bazaarOutput?.type === "json", "extensions.bazaar.info.output.type must be json.");
  assertCheck(typeof bazaarOutput?.example?.subject_id === "string", "extensions.bazaar.info.output.example.subject_id must be present.");
  assertCheck(typeof bazaarOutput?.example?.trust_score === "number", "extensions.bazaar.info.output.example.trust_score must be numeric.");
  assertCheck(bazaarOutput?.example?.status === "allow" || bazaarOutput?.example?.status === "degrade" || bazaarOutput?.example?.status === "block" || bazaarOutput?.example?.status === "quarantine", "extensions.bazaar.info.output.example.status must be a valid trust route.");
  assertCheck(
    bazaarOutput?.example?.receipt && typeof bazaarOutput.example.receipt === "object",
    "extensions.bazaar.info.output.example.receipt must be present."
  );

  const { paymentHeaderB64, bodyPayment } = normalizePaymentInput(challenge);
  const requirementsUsedForPayment = paymentHeaderB64
    ? decodePaymentSignatureHeader(paymentHeaderB64)?.accepted ?? null
    : bodyPayment?.paymentRequirements ?? null;
  assertCheck(Boolean(requirementsUsedForPayment), "Paid flow must preserve payment requirements from challenge.");
  assertCheck(
    Boolean(requirementsUsedForPayment?.resource?.extensions?.bazaar),
    "Paid flow must include payment requirements with resource.extensions.bazaar."
  );
  const paidBody = bodyPayment ? { ...baseBody, payment: bodyPayment } : baseBody;
  const paidHeaders = {
    "content-type": "application/json",
    "x-request-id": `${requestIdPrefix}-paid`,
    "x-request-timestamp": String(Math.floor(Date.now() / 1000)),
    "idempotency-key": `${requestIdPrefix}-idem`
  };
  if (paymentHeaderB64) {
    paidHeaders["payment-signature"] = paymentHeaderB64;
  }

  const paid = await request(endpoint, {
    method: "POST",
    headers: paidHeaders,
    body: JSON.stringify(paidBody)
  });
  assertCheck(paid.response.status === 200, `paid request expected 200, received ${paid.response.status}`);
  assertCheck(paid.json?.receipt?.facilitator_provider === "cdp", "paid receipt must include facilitator_provider: cdp");
  assertCheck(paid.json?.receipt?.x402_verified === true, "paid receipt must include x402_verified: true");
  assertCheck(typeof paid.json?.receipt?.bazaar_extension_status === "string", "paid receipt missing bazaar_extension_status");
  assertCheck(Object.hasOwn(paid.json?.receipt ?? {}, "bazaar_extension_reason"), "paid receipt missing bazaar_extension_reason field");
  assertCheck(Object.hasOwn(paid.json?.receipt ?? {}, "bazaar_extension_raw"), "paid receipt missing bazaar_extension_raw field");
  if (paid.json?.receipt?.bazaar_extension_status === "missing") {
    assertCheck(
      paid.json?.receipt?.bazaar_extension_reason === "EXTENSION-RESPONSES header not present on CDP verify/settle response",
      "paid receipt missing reason must explain missing EXTENSION-RESPONSES header."
    );
  }

  const receiptId = String(paid.json?.receipt?.payment_receipt_id ?? "").trim();
  assertCheck(receiptId, "paid response missing payment_receipt_id");
  const receipt = await request(`${baseUrl}/receipts/${encodeURIComponent(receiptId)}`, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  assertCheck(receipt.response.status === 200, `/receipts/${receiptId} expected 200, received ${receipt.response.status}`);
  assertCheck(typeof receipt.json?.bazaar_extension_status === "string", "receipt proof missing bazaar_extension_status");
  assertCheck(Object.hasOwn(receipt.json ?? {}, "bazaar_extension_reason"), "receipt proof missing bazaar_extension_reason");
  assertCheck(Object.hasOwn(receipt.json ?? {}, "bazaar_extension_raw"), "receipt proof missing bazaar_extension_raw");
  if (receipt.json?.bazaar_extension_status === "missing") {
    assertCheck(
      receipt.json?.bazaar_extension_reason === "EXTENSION-RESPONSES header not present on CDP verify/settle response",
      "receipt proof missing reason must explain missing EXTENSION-RESPONSES header."
    );
  }

  const payTo = String(process.env.X402_PAY_TO ?? paid.json?.receipt?.payTo ?? "").trim();
  assertCheck(payTo, "X402_PAY_TO or paid receipt payTo is required for merchant lookup check.");
  const merchantLookup = await request(
    `https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=${encodeURIComponent(payTo)}&limit=10`,
    { method: "GET", headers: { accept: "application/json" } }
  );
  const merchantStatus = classifyMerchantLookup(merchantLookup.json ?? {}, merchantLookup.response.status);
  assertCheck(["indexed", "not_indexed"].includes(merchantStatus), "merchant lookup did not classify as indexed/not_indexed");

  const summary = {
    checks: {
      unpaid_valid_body_402: true,
      unpaid_empty_body_402: true,
      unpaid_no_body_402: true,
      challenge_includes_extensions_bazaar: true,
      challenge_accepts_requirement_includes_extensions_bazaar: true,
      challenge_bazaar_extension_shape_valid: true,
      paid_flow_preserves_bazaar_extensions_in_payment_requirements: true,
      paid_receipt_facilitator_provider_cdp: true,
      paid_receipt_x402_verified_true: true,
      receipt_has_extension_responses_diagnostics: true,
      merchant_lookup_status: merchantStatus
    },
    receipt_id: receiptId,
    payTo
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
