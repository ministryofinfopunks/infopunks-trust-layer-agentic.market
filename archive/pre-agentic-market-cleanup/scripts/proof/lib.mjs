import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const MAINNET_CAIP2 = "eip155:8453";

function truthy(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "base") {
    return MAINNET_CAIP2;
  }
  if (normalized === "base-sepolia") {
    return "eip155:84532";
  }
  return normalized;
}

function nowIso() {
  return new Date().toISOString();
}

function epochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function resolveProofConfig() {
  const baseUrl = String(process.env.INFOPUNKS_TRUST_API_URL ?? "http://127.0.0.1:4021").trim().replace(/\/$/, "");
  const basePayment = safeJsonParse(process.env.FACILITATOR_PAYMENT_JSON ?? "", null);
  const network = normalizeNetwork(
    process.env.PROOF_NETWORK
    ?? basePayment?.network
    ?? basePayment?.paymentRequirements?.network
    ?? String(process.env.X402_SUPPORTED_NETWORKS ?? "eip155:84532").split(",")[0]
  );
  const payTo = String(
    process.env.PROOF_PAY_TO
    ?? process.env.X402_PAY_TO
    ?? basePayment?.payTo
    ?? basePayment?.paymentRequirements?.payTo
    ?? ""
  ).trim();
  const amountUnits = asNumber(process.env.PROOF_AMOUNT_UNITS, 1);
  const allowMainnet = truthy(process.env.INFOPUNKS_ALLOW_MAINNET_PROOF);
  const artifactsDir = path.join(process.cwd(), "artifacts", "launch-proof");

  return {
    baseUrl,
    endpointUrl: `${baseUrl}/trust-score`,
    warRoomEventsUrl: `${baseUrl}/api/war-room/events`,
    basePayment,
    network,
    payTo,
    amountUnits,
    allowMainnet,
    artifactsDir,
    apiKey: process.env.INFOPUNKS_API_KEY ?? null
  };
}

export function assertProofSafety(config) {
  if (!config.network) {
    throw new Error("Unable to determine payment network. Set PROOF_NETWORK or X402_SUPPORTED_NETWORKS.");
  }
  if (config.network === MAINNET_CAIP2 && !config.allowMainnet) {
    throw new Error(
      "Mainnet proof run blocked. Set INFOPUNKS_ALLOW_MAINNET_PROOF=true only if you intentionally want mainnet."
    );
  }
}

export function printExecutionBanner(config) {
  const lines = [
    "== Infopunks Paid Call Proof ==",
    `Network: ${config.network}`,
    `PayTo: ${config.payTo || "not set"}`,
    `Amount (units): ${config.amountUnits}`,
    `Endpoint: ${config.endpointUrl}`
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function buildPayment({ subjectId, payerOverride = null, nonceOverride = null, idempotencyOverride = null, requestTimestamp = null }) {
  const basePayment = safeJsonParse(process.env.FACILITATOR_PAYMENT_JSON ?? "", null);
  const nonce = nonceOverride ?? `nonce_${subjectId}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const idempotencyKey = idempotencyOverride ?? `idem_${subjectId}_${Date.now()}`;
  const payment = {
    rail: basePayment?.rail ?? "x402",
    payer: payerOverride ?? basePayment?.payer ?? process.env.PROOF_PAYER ?? "proof-runner",
    units_authorized: asNumber(basePayment?.units_authorized ?? process.env.PROOF_UNITS_AUTHORIZED, 5),
    nonce,
    idempotency_key: idempotencyKey,
    request_timestamp: requestTimestamp ?? epochSeconds()
  };

  for (const key of ["asset", "network", "proof", "proof_id", "reference", "session_id", "verifier_reference"]) {
    if (basePayment?.[key] != null) {
      payment[key] = basePayment[key];
    }
  }
  if (basePayment?.paymentPayload != null) {
    payment.paymentPayload = basePayment.paymentPayload;
  }
  if (basePayment?.paymentRequirements != null) {
    payment.paymentRequirements = basePayment.paymentRequirements;
  }
  return payment;
}

export async function fetchWarRoomEvents(config) {
  const response = await fetch(config.warRoomEventsUrl, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    }
  });
  if (!response.ok) {
    throw new Error(`War Room events fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.events) ? payload.events : [];
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findMatchingWarRoomEvent({ config, subjectId, payer, startedAtMs }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const events = await fetchWarRoomEvents(config).catch(() => []);
    const match = events.find((event) => {
      const eventTime = Date.parse(String(event?.timestamp ?? ""));
      if (!Number.isFinite(eventTime)) {
        return false;
      }
      if (eventTime < startedAtMs - 5000) {
        return false;
      }
      const eventSubject = String(event?.subject_id ?? "");
      const eventPayer = String(event?.payer ?? "");
      if (eventSubject && subjectId && eventSubject !== subjectId) {
        return false;
      }
      if (eventPayer && payer && eventPayer !== payer) {
        return false;
      }
      return true;
    });
    if (match) {
      return match;
    }
    await sleep(350);
  }
  return null;
}

export async function executePaidTrustCall({
  config,
  subjectId,
  context = null,
  payment,
  label = "paid_call"
}) {
  const startedAtMs = Date.now();
  const body = {
    entity_id: subjectId,
    context: context ?? {
      task_type: "agentic.market.execution",
      domain: "general",
      risk_level: "medium"
    },
    payment
  };
  const response = await fetch(config.endpointUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const payload = safeJsonParse(text, { raw: text });
  const warRoomEvent = await findMatchingWarRoomEvent({
    config,
    subjectId,
    payer: payment?.payer ?? null,
    startedAtMs
  });

  return {
    label,
    timestamp: nowIso(),
    http_status: response.status,
    payer: payment?.payer ?? null,
    subject_id: subjectId,
    trust_score: payload?.trust_score ?? payload?.score ?? null,
    trust_tier: payload?.trust_tier ?? payload?.risk_level ?? null,
    mode: payload?.mode ?? null,
    confidence: payload?.confidence ?? null,
    status: warRoomEvent?.status ?? (response.ok ? "success" : "failed"),
    receipt_id: warRoomEvent?.receipt_id ?? null,
    amount: warRoomEvent?.amount ?? null,
    war_room_event_id: warRoomEvent?.event_id ?? null,
    error_code: payload?.error?.code ?? warRoomEvent?.error_code ?? null,
    reason: payload?.error?.message ?? payload?.policy?.reason ?? warRoomEvent?.reason ?? null,
    response_payload: payload
  };
}

function markdownSummary({ calls, warRoomEvents, config }) {
  const total = calls.length;
  const successful = calls.filter((entry) => Number(entry.http_status) >= 200 && Number(entry.http_status) < 300).length;
  const failed = calls.filter((entry) =>
    Number(entry.http_status) >= 400
    || String(entry.status ?? "").toLowerCase() === "failed"
    || String(entry.status ?? "").toLowerCase() === "rejected"
  ).length;
  const degraded = calls.filter((entry) => String(entry.mode ?? "").toLowerCase() === "degraded").length;
  const receipts = [...new Set(calls.map((entry) => entry.receipt_id).filter(Boolean))];
  const subjects = [...new Set(calls.map((entry) => entry.subject_id).filter(Boolean))];

  return [
    "# Launch Proof Summary",
    "",
    `- Generated at: ${nowIso()}`,
    `- Total calls: ${total}`,
    `- Successful calls: ${successful}`,
    `- Failed/rejected calls: ${failed}`,
    `- Degraded calls: ${degraded}`,
    `- Receipts: ${receipts.length > 0 ? receipts.join(", ") : "none"}`,
    `- Subjects checked: ${subjects.join(", ")}`,
    `- War Room URL: ${config.baseUrl}/war-room`,
    "",
    "## Calls",
    "",
    "| label | status | subject_id | payer | trust_score | trust_tier | mode | confidence | receipt_id | error_code |",
    "|---|---|---|---|---:|---|---|---:|---|---|",
    ...calls.map((entry) => `| ${entry.label} | ${entry.http_status} | ${entry.subject_id} | ${entry.payer ?? ""} | ${entry.trust_score ?? ""} | ${entry.trust_tier ?? ""} | ${entry.mode ?? ""} | ${entry.confidence ?? ""} | ${entry.receipt_id ?? ""} | ${entry.error_code ?? ""} |`),
    "",
    "## Wallet Testing (2 External Wallets)",
    "",
    "1. Set env vars per wallet before each run:",
    "   - `FACILITATOR_PAYMENT_JSON` with wallet-specific `payer`, `nonce`, `idempotency_key` (or allow script to override nonce/idempotency).",
    "   - `INFOPUNKS_TRUST_API_URL`, `PROOF_NETWORK`, optional `X402_PAY_TO`.",
    "2. Run `npm run proof:paid-sequence` once per wallet.",
    "3. Confirm both wallet addresses appear as `payer` values in War Room at `/war-room` or via `/api/war-room/events`.",
    "",
    "## Notes",
    "",
    `- Captured War Room events in this run: ${warRoomEvents.length}`
  ].join("\n");
}

export function writeProofArtifacts({ config, calls, warRoomEvents }) {
  mkdirSync(config.artifactsDir, { recursive: true });
  const receipts = calls
    .filter((entry) => entry.receipt_id)
    .map((entry) => ({
      receipt_id: entry.receipt_id,
      payer: entry.payer,
      subject_id: entry.subject_id,
      amount: entry.amount,
      status: entry.status,
      timestamp: entry.timestamp
    }));

  const files = {
    receipts: path.join(config.artifactsDir, "receipts.json"),
    logs: path.join(config.artifactsDir, "trust-call-logs.json"),
    events: path.join(config.artifactsDir, "war-room-events.json"),
    summary: path.join(config.artifactsDir, "proof-summary.md")
  };

  writeFileSync(files.receipts, JSON.stringify(receipts, null, 2));
  writeFileSync(files.logs, JSON.stringify(calls, null, 2));
  writeFileSync(files.events, JSON.stringify(warRoomEvents, null, 2));
  writeFileSync(files.summary, markdownSummary({ calls, warRoomEvents, config }));

  return files;
}

export function printSingleCallProof(call) {
  const printable = {
    status: call.http_status,
    payer: call.payer,
    subject_id: call.subject_id,
    trust_score: call.trust_score,
    trust_tier: call.trust_tier,
    mode: call.mode,
    confidence: call.confidence,
    receipt_id: call.receipt_id,
    amount: call.amount,
    war_room_event_id: call.war_room_event_id
  };
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
}
