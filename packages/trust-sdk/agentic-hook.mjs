function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? "").trim().replace(/\/$/, "");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapTrustTier(raw) {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized) {
    return normalized;
  }
  return "unverified";
}

function mapDecision(payload) {
  if (typeof payload?.decision === "string" && payload.decision.trim()) {
    return payload.decision.trim();
  }
  if (typeof payload?.policy?.route === "string" && payload.policy.route.trim()) {
    return payload.policy.route.trim();
  }
  return "degrade";
}

function mapReason(payload) {
  if (typeof payload?.reason === "string" && payload.reason.trim()) {
    return payload.reason.trim();
  }
  if (typeof payload?.policy?.reason === "string" && payload.policy.reason.trim()) {
    return payload.policy.reason.trim();
  }
  return "trust_resolution_unavailable";
}

function mapMode(payload) {
  const normalized = String(payload?.mode ?? "").trim().toLowerCase();
  if (normalized === "verified" || normalized === "degraded") {
    return normalized;
  }
  return "degraded";
}

function normalizeDecision(payload, fallbackSubjectId) {
  return {
    subject_id: String(payload?.subject_id ?? payload?.entity_id ?? fallbackSubjectId),
    trust_score: toNumber(payload?.trust_score ?? payload?.score, 0),
    trust_tier: mapTrustTier(payload?.trust_tier ?? payload?.trust_state ?? payload?.risk_level),
    mode: mapMode(payload),
    confidence: toNumber(payload?.confidence, 0),
    decision: mapDecision(payload),
    reason: mapReason(payload)
  };
}

function buildPaymentPayload(subjectId, overrides = {}) {
  const nonce = overrides.nonce ?? `nonce_${subjectId}_${nowSeconds()}_${randomSuffix()}`;
  const idempotencyKey = overrides.idempotency_key ?? `idem_${subjectId}_${nowSeconds()}`;
  return {
    rail: overrides.rail ?? "x402",
    payer: overrides.payer ?? process.env.INFOPUNKS_PAYMENT_PAYER ?? "agentic-hook-demo",
    units_authorized: toNumber(overrides.units_authorized ?? process.env.INFOPUNKS_PAYMENT_UNITS_AUTHORIZED, 5),
    nonce,
    idempotency_key: idempotencyKey,
    request_timestamp: overrides.request_timestamp ?? nowSeconds(),
    ...(overrides.proof ? { proof: overrides.proof } : {}),
    ...(overrides.proof_id ? { proof_id: overrides.proof_id } : {})
  };
}

export class UnsafeExecutorError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = "UnsafeExecutorError";
    this.code = "UNSAFE_EXECUTOR";
    this.decision = decision;
  }
}

export function createAgenticTrustClient({
  baseUrl = process.env.INFOPUNKS_TRUST_API_URL ?? "http://127.0.0.1:4021",
  apiKey = process.env.INFOPUNKS_API_KEY ?? null,
  minTrustScore = toNumber(process.env.INFOPUNKS_MIN_TRUST_SCORE, 50),
  minConfidence = toNumber(process.env.INFOPUNKS_MIN_CONFIDENCE, 0.5),
  defaultPayment = {}
} = {}) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/trust-score`;

  return {
    async resolveTrust({ subject_id, context = {}, payment = {} }) {
      if (!subject_id) {
        throw new Error("resolveTrust requires subject_id");
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          entity_id: subject_id,
          context,
          payment: buildPaymentPayload(subject_id, { ...defaultPayment, ...payment })
        })
      });
      const bodyText = await response.text();
      let payload = null;
      try {
        payload = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        payload = { reason: bodyText };
      }

      if (!response.ok) {
        const error = new Error(payload?.error?.message ?? `Trust endpoint failed with status ${response.status}`);
        error.code = payload?.error?.code ?? "TRUST_RESOLUTION_FAILED";
        error.status = response.status;
        error.details = payload?.error?.details ?? null;
        throw error;
      }

      return normalizeDecision(payload, subject_id);
    },

    async requireTrustedExecutor({ subject_id, context = {}, minScore = minTrustScore, minConfidence: minimumConfidence = minConfidence, payment = {} }) {
      const decision = await this.resolveTrust({ subject_id, context, payment });
      if (decision.trust_score < minScore) {
        throw new UnsafeExecutorError(
          `Executor ${subject_id} blocked: trust_score ${decision.trust_score} < minScore ${minScore}`,
          decision
        );
      }

      if (decision.mode === "degraded") {
        if (decision.confidence < minimumConfidence) {
          throw new UnsafeExecutorError(
            `Executor ${subject_id} blocked in degraded mode: confidence ${decision.confidence} < minConfidence ${minimumConfidence}`,
            decision
          );
        }
      }

      return decision;
    }
  };
}

let defaultAgenticTrustClient = null;

function getDefaultAgenticTrustClient() {
  if (!defaultAgenticTrustClient) {
    defaultAgenticTrustClient = createAgenticTrustClient();
  }
  return defaultAgenticTrustClient;
}

export async function resolveTrust(input) {
  return getDefaultAgenticTrustClient().resolveTrust(input);
}

export async function requireTrustedExecutor(input) {
  return getDefaultAgenticTrustClient().requireTrustedExecutor(input);
}
