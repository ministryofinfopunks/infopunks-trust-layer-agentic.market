import { createHmac } from "node:crypto";

function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.race([
    promise(controller.signal),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Verifier timeout.")), timeoutMs + 10);
    })
  ]).finally(() => clearTimeout(timer));
}

function hasReplayIdentity({ nonce, proofId, verifierReference, sessionId, payer }) {
  return Boolean(verifierReference || proofId || nonce || (sessionId && payer));
}

function extractPayerFromPaymentPayload(paymentPayload) {
  const from = paymentPayload?.payload?.authorization?.from;
  return typeof from === "string" && from.trim() ? from : null;
}

function extractNonceFromPaymentPayload(paymentPayload) {
  const nonce = paymentPayload?.payload?.authorization?.nonce;
  return typeof nonce === "string" && nonce.trim() ? nonce : null;
}

function localStrictVerify({ payment, requiredUnits, sharedSecret, fallbackPayer }) {
  const rail = payment?.rail ?? "x402";
  const payer = payment?.payer ?? fallbackPayer ?? "anonymous";

  if (rail !== "x402") {
    return {
      ok: false,
      reason: "PAYMENT_VERIFICATION_FAILED",
      details: { expected_rail: "x402", received_rail: rail }
    };
  }
  if (!Number.isFinite(payment?.units_authorized) || payment.units_authorized < requiredUnits) {
    return {
      ok: false,
      reason: "ENTITLEMENT_REQUIRED",
      details: { required_units: requiredUnits, units_authorized: payment?.units_authorized ?? 0, payer }
    };
  }
  if (!hasReplayIdentity({
    nonce: payment?.nonce ?? null,
    proofId: payment?.proof_id ?? payment?.reference ?? payment?.proof ?? null,
    verifierReference: payment?.reference ?? null,
    sessionId: payment?.session_id ?? null,
    payer
  })) {
    return {
      ok: false,
      reason: "PAYMENT_VERIFICATION_FAILED",
      details: { payer, verification: "missing_replay_identity" }
    };
  }
  if (sharedSecret) {
    if (!payment?.nonce || !payment?.proof) {
      return {
        ok: false,
        reason: "PAYMENT_VERIFICATION_FAILED",
        details: { payer, verification: "missing_proof" }
      };
    }
    const payload = `${payer}:${payment.nonce}:${payment.units_authorized}`;
    const expected = createHmac("sha256", sharedSecret).update(payload).digest("hex");
    if (expected !== payment.proof) {
      return {
        ok: false,
        reason: "PAYMENT_VERIFICATION_FAILED",
        details: { payer, verification: "invalid_proof" }
      };
    }
  }

  return {
    ok: true,
    payer,
    nonce: payment?.nonce ?? null,
    proof_id: payment?.proof_id ?? payment?.reference ?? payment?.proof ?? null,
    session_id: payment?.session_id ?? null,
    verifier_reference: payment?.reference ?? payment?.proof_id ?? null,
    settlement_status: "provisional",
    details: {
      mode: sharedSecret ? "strict-hmac" : "strict-basic"
    }
  };
}

export class X402Verifier {
  constructor({ mode = "facilitator", verifierUrl, verifierApiKey, timeoutMs = 5000, sharedSecret, logger }) {
    this.mode = mode;
    this.verifierUrl = verifierUrl;
    this.verifierApiKey = verifierApiKey;
    this.timeoutMs = timeoutMs;
    this.sharedSecret = sharedSecret;
    this.logger = logger;
  }

  async verify({ payment, requiredUnits, operation, fallbackPayer, adapterTraceId, entitlement }) {
    const started = Date.now();
    const x402PaymentPayload = payment?.paymentPayload ?? null;
    const x402PaymentRequirements = payment?.paymentRequirements ?? null;
    const x402NativeFlow = Boolean(x402PaymentPayload && x402PaymentRequirements);
    const payloadPayer = extractPayerFromPaymentPayload(x402PaymentPayload);
    const payloadNonce = extractNonceFromPaymentPayload(x402PaymentPayload);

    if (this.mode === "stub") {
      const result = {
        ok: true,
        payer: payment?.payer ?? payloadPayer ?? fallbackPayer ?? entitlement?.payer ?? "anonymous",
        nonce: payment?.nonce ?? payloadNonce ?? `stub_nonce_${adapterTraceId}`,
        proof_id: payment?.proof_id ?? payment?.reference ?? `stub_proof_${adapterTraceId}`,
        session_id: payment?.session_id ?? entitlement?.session_id ?? null,
        verifier_reference: `stub_ref_${adapterTraceId}`,
        settlement_status: "provisional",
        details: { mode: "stub" }
      };
      this.logger?.info?.({
        event: "x402_verify",
        mode: this.mode,
        operation,
        adapter_trace_id: adapterTraceId,
        outcome: "ok",
        latency_ms: Date.now() - started
      });
      return result;
    }

    if (this.mode === "strict") {
      const strict = localStrictVerify({ payment, requiredUnits, sharedSecret: this.sharedSecret, fallbackPayer });
      this.logger?.info?.({
        event: "x402_verify",
        mode: this.mode,
        operation,
        adapter_trace_id: adapterTraceId,
        outcome: strict.ok ? "ok" : strict.reason,
        latency_ms: Date.now() - started
      });
      return strict;
    }

    if (!this.verifierUrl) {
      return {
        ok: false,
        reason: "PAYMENT_VERIFICATION_FAILED",
        details: { message: "Verifier URL is missing for facilitator mode." }
      };
    }

    try {
      const payload = x402NativeFlow
        ? {
          paymentPayload: x402PaymentPayload,
          paymentRequirements: x402PaymentRequirements
        }
        : {
          payment,
          required_units: requiredUnits,
          operation,
          adapter_trace_id: adapterTraceId,
          fallback_payer: fallbackPayer,
          entitlement
        };
      const response = await withTimeout(
        (signal) =>
          fetch(`${this.verifierUrl.replace(/\/$/, "")}/verify`, {
            method: "POST",
            signal,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              ...(this.verifierApiKey ? { authorization: `Bearer ${this.verifierApiKey}` } : {})
            },
            body: JSON.stringify(payload)
          }),
        this.timeoutMs
      );

      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = {
          ok: false,
          reason: "PAYMENT_VERIFICATION_FAILED",
          details: {
            status: response.status,
            verifier_body: responseBody
          }
        };
        this.logger?.warn?.({
          event: "x402_verify",
          mode: this.mode,
          operation,
          adapter_trace_id: adapterTraceId,
          outcome: error.reason,
          latency_ms: Date.now() - started
        });
        return error;
      }

      const result = {
        ok: typeof responseBody?.ok === "boolean" ? responseBody.ok : Boolean(responseBody?.isValid),
        reason: responseBody?.reason ?? responseBody?.invalidReason,
        details: responseBody?.details ?? {},
        payer: responseBody?.payer ?? payment?.payer ?? payloadPayer ?? fallbackPayer ?? null,
        nonce: responseBody?.nonce ?? payment?.nonce ?? payloadNonce ?? null,
        proof_id: responseBody?.proof_id ?? payment?.proof_id ?? payment?.reference ?? null,
        session_id: responseBody?.session_id ?? payment?.session_id ?? null,
        verifier_reference: responseBody?.verifier_reference ?? responseBody?.receipt_reference ?? null,
        settlement_status: responseBody?.settlement_status ?? "provisional"
      };
      const authorizedUnits = responseBody?.units_authorized ?? payment?.units_authorized;
      if (!x402NativeFlow && result.ok && (!Number.isFinite(authorizedUnits) || authorizedUnits < requiredUnits)) {
        result.ok = false;
        result.reason = "ENTITLEMENT_REQUIRED";
        result.details = {
          ...(result.details ?? {}),
          required_units: requiredUnits,
          units_authorized: Number.isFinite(authorizedUnits) ? authorizedUnits : null
        };
      }
      if (result.ok && !hasReplayIdentity({
        nonce: result.nonce,
        proofId: result.proof_id,
        verifierReference: result.verifier_reference,
        sessionId: result.session_id,
        payer: result.payer
      })) {
        result.ok = false;
        result.reason = "PAYMENT_VERIFICATION_FAILED";
        result.details = {
          ...(result.details ?? {}),
          verification: "missing_replay_identity"
        };
      }
      this.logger?.info?.({
        event: "x402_verify",
        mode: this.mode,
        operation,
        adapter_trace_id: adapterTraceId,
        outcome: result.ok ? "ok" : result.reason ?? "failed",
        latency_ms: Date.now() - started,
        verifier_reference: result.verifier_reference
      });
      return result;
    } catch (error) {
      const failure = {
        ok: false,
        reason: "PAYMENT_VERIFICATION_FAILED",
        details: { message: error?.message ?? "Verifier request failed." }
      };
      this.logger?.warn?.({
        event: "x402_verify",
        mode: this.mode,
        operation,
        adapter_trace_id: adapterTraceId,
        outcome: failure.reason,
        latency_ms: Date.now() - started
      });
      return failure;
    }
  }

  async readiness(adapterTraceId = null) {
    if (this.mode === "stub") {
      return { connected: true, mode: this.mode, reason: "stub_mode" };
    }
    if (this.mode === "strict") {
      return { connected: Boolean(this.sharedSecret), mode: this.mode, reason: this.sharedSecret ? "shared_secret_configured" : "missing_shared_secret" };
    }
    if (!this.verifierUrl) {
      return { connected: false, mode: this.mode, reason: "missing_verifier_url" };
    }

    try {
      const response = await withTimeout(
        (signal) =>
          fetch(`${this.verifierUrl.replace(/\/$/, "")}/health`, {
            method: "GET",
            signal,
            headers: {
              accept: "application/json",
              ...(this.verifierApiKey ? { authorization: `Bearer ${this.verifierApiKey}` } : {}),
              ...(adapterTraceId ? { "x-adapter-trace-id": adapterTraceId } : {})
            }
          }),
        Math.min(this.timeoutMs, 3000)
      );
      return {
        connected: response.status < 500,
        mode: this.mode,
        reason: `health_status_${response.status}`
      };
    } catch {
      return {
        connected: false,
        mode: this.mode,
        reason: "health_probe_failed"
      };
    }
  }

  async getReceiptStatus(reference, adapterTraceId) {
    if (!reference || !this.verifierUrl || this.mode === "stub") {
      return null;
    }
    try {
      const response = await withTimeout(
        (signal) =>
          fetch(`${this.verifierUrl.replace(/\/$/, "")}/receipts/${encodeURIComponent(reference)}`, {
            method: "GET",
            signal,
            headers: {
              accept: "application/json",
              ...(this.verifierApiKey ? { authorization: `Bearer ${this.verifierApiKey}` } : {}),
              ...(adapterTraceId ? { "x-adapter-trace-id": adapterTraceId } : {})
            }
          }),
        this.timeoutMs
      );
      if (!response.ok) {
        return null;
      }
      return await response.json().catch(() => null);
    } catch {
      return null;
    }
  }
}
