import { createHmac } from "node:crypto";
import { createCdpAuthHeaders } from "@coinbase/x402";

const CDP_EXTENSION_RESPONSES_HEADER = "EXTENSION-RESPONSES";
const KNOWN_EXTENSION_STATUSES = new Set(["processing", "accepted", "rejected", "error"]);

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

function byteLengthFromHex(value) {
  if (typeof value !== "string") {
    return 0;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  const withoutPrefix = normalized.startsWith("0x") ? normalized.slice(2) : normalized;
  if (!withoutPrefix || withoutPrefix.length % 2 !== 0) {
    return 0;
  }
  return withoutPrefix.length / 2;
}

function isHexString(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (!/^0x[0-9a-fA-F]+$/.test(normalized)) {
    return false;
  }
  return normalized.length % 2 === 0;
}

function isByteArrayLike(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

function toUint8Array(value) {
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function toHexFromBytesLike(value) {
  if (!isByteArrayLike(value)) {
    return value;
  }
  const bytes = toUint8Array(value);
  if (!bytes) {
    return value;
  }
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function normalizeHexBytesLike(value) {
  if (isHexString(value)) {
    return value.trim();
  }
  return toHexFromBytesLike(value);
}

function valueType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object" && value?.constructor?.name) {
    return value.constructor.name;
  }
  return typeof value;
}

function cdpV2PayloadPair(payment) {
  const paymentPayload = payment?.paymentPayload ?? null;
  const paymentRequirements = payment?.paymentRequirements ?? paymentPayload?.accepted ?? null;
  return { paymentPayload, paymentRequirements };
}

function normalizeCdpPaymentPayload(paymentPayload) {
  if (!paymentPayload || typeof paymentPayload !== "object") {
    return paymentPayload;
  }
  const payload = paymentPayload?.payload;
  if (!payload || typeof payload !== "object") {
    return paymentPayload;
  }
  const authorization = payload?.authorization;
  const normalizedSignature = normalizeHexBytesLike(payload?.signature);
  const normalizedNonce = normalizeHexBytesLike(authorization?.nonce);

  const signatureChanged = normalizedSignature !== payload?.signature;
  const nonceChanged = normalizedNonce !== authorization?.nonce;
  if (!signatureChanged && !nonceChanged) {
    return paymentPayload;
  }

  const normalizedAuthorization = nonceChanged
    ? { ...authorization, nonce: normalizedNonce }
    : authorization;
  const normalizedPayload = {
    ...payload,
    ...(nonceChanged ? { authorization: normalizedAuthorization } : {}),
    ...(signatureChanged ? { signature: normalizedSignature } : {})
  };
  return {
    ...paymentPayload,
    payload: normalizedPayload
  };
}

function cdpV2PhasePayload({ paymentPayload, paymentRequirements }) {
  const normalizedPaymentPayload = normalizeCdpPaymentPayload(paymentPayload);
  const payloadWithVersion = paymentPayload && typeof paymentPayload === "object"
    ? { x402Version: 2, ...normalizedPaymentPayload }
    : normalizedPaymentPayload;
  return {
    x402Version: 2,
    paymentPayload: payloadWithVersion,
    paymentRequirements
  };
}

function logCdpFacilitatorPayloadShape({ logger, phase, payload }) {
  const paymentPayload = payload?.paymentPayload ?? null;
  const paymentRequirements = payload?.paymentRequirements ?? null;
  const authorization = paymentPayload?.payload?.authorization ?? null;
  const signature = paymentPayload?.payload?.signature ?? null;
  const nonce = authorization?.nonce ?? null;
  logger?.info?.({
    event: "cdp_facilitator_payload_shape",
    phase,
    has_x402Version: Object.hasOwn(payload ?? {}, "x402Version"),
    x402Version: payload?.x402Version ?? null,
    has_paymentPayload: Boolean(paymentPayload),
    has_paymentRequirements: Boolean(paymentRequirements),
    payload_scheme: paymentPayload?.accepted?.scheme ?? paymentRequirements?.scheme ?? null,
    payload_network: paymentPayload?.accepted?.network ?? paymentRequirements?.network ?? null,
    payload_auth_from: authorization?.from ?? null,
    payload_auth_to: authorization?.to ?? null,
    payload_auth_value: authorization?.value ?? null,
    payload_auth_validAfter: authorization?.validAfter ?? null,
    payload_auth_validBefore: authorization?.validBefore ?? null,
    payload_nonce_len: byteLengthFromHex(nonce),
    payload_nonce_type: valueType(nonce),
    payload_nonce_is_array: isByteArrayLike(nonce),
    payload_nonce_is_hex: isHexString(nonce),
    payload_nonce_string_len: typeof nonce === "string" ? nonce.trim().length : null,
    has_signature: typeof signature === "string" && signature.trim().length > 0,
    signature_len: byteLengthFromHex(signature),
    signature_type: valueType(signature),
    signature_is_array: isByteArrayLike(signature),
    signature_is_hex: isHexString(signature),
    signature_string_len: typeof signature === "string" ? signature.trim().length : null,
    auth_value_type: valueType(authorization?.value ?? null),
    auth_validAfter_type: valueType(authorization?.validAfter ?? null),
    auth_validBefore_type: valueType(authorization?.validBefore ?? null),
    req_scheme: paymentRequirements?.scheme ?? null,
    req_network: paymentRequirements?.network ?? null,
    req_asset: paymentRequirements?.asset ?? null,
    req_payTo: paymentRequirements?.payTo ?? null,
    req_amount: paymentRequirements?.amount ?? null,
    req_maxTimeoutSeconds: paymentRequirements?.maxTimeoutSeconds ?? null,
    req_extra_name: paymentRequirements?.extra?.name ?? null,
    req_extra_version: paymentRequirements?.extra?.version ?? null,
    req_extra_symbol: paymentRequirements?.extra?.symbol ?? null
  });
}

function sanitizeExtensionText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeExtensionStatus(value) {
  const normalized = sanitizeExtensionText(value)?.toLowerCase() ?? null;
  return normalized && KNOWN_EXTENSION_STATUSES.has(normalized) ? normalized : null;
}

function splitStructuredHeader(value) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) {
    parts.push(trimmed);
  }
  return parts;
}

function unquoteStructuredValue(value) {
  const trimmed = sanitizeExtensionText(value);
  if (!trimmed) {
    return null;
  }
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim() || null;
  }
  return trimmed;
}

function normalizeExtensionEntry(entry, fallbackName = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const extensionName = sanitizeExtensionText(
    entry.extension_name
    ?? entry.extension
    ?? entry.name
    ?? entry.id
    ?? fallbackName
  );
  const status = normalizeExtensionStatus(entry.status ?? entry.state ?? entry.result ?? entry.outcome);
  const reason = sanitizeExtensionText(entry.reason);
  const message = sanitizeExtensionText(entry.message ?? entry.error ?? entry.detail);
  if (!extensionName && !status && !reason && !message) {
    return null;
  }
  return {
    ...(extensionName ? { extension_name: extensionName } : {}),
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {}),
    ...(message ? { message } : {})
  };
}

function parseStructuredExtensionEntries(value) {
  return splitStructuredHeader(value)
    .map((segment) => {
      const tokens = segment.split(/[;|]/).map((token) => token.trim()).filter(Boolean);
      const fields = {};
      const bareTokens = [];
      for (const token of tokens) {
        const match = token.match(/^([^=:]+)\s*[:=]\s*(.+)$/);
        if (!match) {
          bareTokens.push(unquoteStructuredValue(token));
          continue;
        }
        const key = match[1].trim().toLowerCase().replace(/[\s-]+/g, "_");
        fields[key] = unquoteStructuredValue(match[2]);
      }
      const bareStatus = bareTokens.find((token) => normalizeExtensionStatus(token));
      const bareName = bareTokens.find((token) => token && !normalizeExtensionStatus(token));
      return normalizeExtensionEntry({
        extension_name: fields.extension_name ?? fields.extension ?? fields.name ?? fields.id ?? bareName,
        status: fields.status ?? fields.state ?? fields.result ?? fields.outcome ?? bareStatus,
        reason: fields.reason,
        message: fields.message ?? fields.error ?? fields.detail
      });
    })
    .filter(Boolean);
}

function normalizeExtensionEntries(value, fallbackName = null) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeExtensionEntries(entry, fallbackName));
  }
  if (typeof value === "string") {
    return parseStructuredExtensionEntries(value);
  }
  if (typeof value !== "object") {
    return [];
  }

  const nested = value.extensions
    ?? value.extensionResponses
    ?? value.extension_responses
    ?? value.responses
    ?? value.results
    ?? value.items
    ?? value.data;
  if (nested) {
    const normalizedNested = normalizeExtensionEntries(nested, fallbackName);
    if (normalizedNested.length) {
      return normalizedNested;
    }
  }

  const directEntry = normalizeExtensionEntry(value, fallbackName);
  if (
    directEntry
    && (
      Object.hasOwn(value, "status")
      || Object.hasOwn(value, "state")
      || Object.hasOwn(value, "result")
      || Object.hasOwn(value, "outcome")
      || Object.hasOwn(value, "reason")
      || Object.hasOwn(value, "message")
      || Object.hasOwn(value, "error")
      || Object.hasOwn(value, "detail")
    )
  ) {
    return [directEntry];
  }

  const nestedEntries = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue && typeof nestedValue === "object") {
      nestedEntries.push(...normalizeExtensionEntries(nestedValue, key));
    }
  }
  if (nestedEntries.length) {
    return nestedEntries;
  }

  return directEntry ? [directEntry] : [];
}

function parseExtensionResponsesHeader(headerValue) {
  const sanitized = sanitizeExtensionText(headerValue);
  if (!sanitized) {
    return [];
  }
  if (sanitized.startsWith("{") || sanitized.startsWith("[")) {
    try {
      return normalizeExtensionEntries(JSON.parse(sanitized));
    } catch {
      return parseStructuredExtensionEntries(sanitized);
    }
  }
  return parseStructuredExtensionEntries(sanitized);
}

function logCdpExtensionResponses({ logger, phase, response, adapterTraceId = null }) {
  const headerValue = sanitizeExtensionText(
    response?.headers?.get?.(CDP_EXTENSION_RESPONSES_HEADER)
    ?? response?.headers?.get?.(CDP_EXTENSION_RESPONSES_HEADER.toLowerCase())
  );
  const extensionResponses = parseExtensionResponsesHeader(headerValue);
  logger?.info?.({
    event: "cdp_extension_responses",
    phase,
    adapter_trace_id: adapterTraceId,
    cdp_status: response?.status ?? null,
    extension_responses_header_present: headerValue !== null,
    extension_responses_header_value: headerValue,
    extension_responses_count: extensionResponses.length,
    ...(extensionResponses.length ? { extension_responses: extensionResponses } : {})
  });
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
  constructor({
    mode = "facilitator",
    facilitatorProvider = "openfacilitator",
    verifierUrl,
    verifierApiKey,
    cdpApiKeyId,
    cdpApiKeySecret,
    timeoutMs = 5000,
    sharedSecret,
    logger
  }) {
    this.mode = mode;
    this.facilitatorProvider = facilitatorProvider;
    this.verifierUrl = verifierUrl;
    this.verifierApiKey = verifierApiKey;
    this.cdpAuthHeaders = facilitatorProvider === "cdp"
      ? createCdpAuthHeaders(cdpApiKeyId, cdpApiKeySecret)
      : null;
    this.timeoutMs = timeoutMs;
    this.sharedSecret = sharedSecret;
    this.logger = logger;
  }

  async authHeaders(kind) {
    if (this.facilitatorProvider === "cdp") {
      const headers = await this.cdpAuthHeaders?.();
      return headers?.[kind] ?? {};
    }
    return this.verifierApiKey ? { authorization: `Bearer ${this.verifierApiKey}` } : {};
  }

  async verify({ payment, requiredUnits, operation, fallbackPayer, adapterTraceId, entitlement }) {
    const started = Date.now();
    const { paymentPayload: x402PaymentPayload, paymentRequirements: x402PaymentRequirements } = cdpV2PayloadPair(payment);
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
        facilitator_provider: this.facilitatorProvider,
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
        facilitator_provider: this.facilitatorProvider,
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
          ...(this.facilitatorProvider === "cdp"
            ? cdpV2PhasePayload({
              paymentPayload: x402PaymentPayload,
              paymentRequirements: x402PaymentRequirements
            })
            : {
              paymentPayload: x402PaymentPayload,
              paymentRequirements: x402PaymentRequirements
            })
        }
        : {
          payment,
          required_units: requiredUnits,
          operation,
          adapter_trace_id: adapterTraceId,
          fallback_payer: fallbackPayer,
          entitlement
        };
      if (this.facilitatorProvider === "cdp" && x402NativeFlow) {
        logCdpFacilitatorPayloadShape({
          logger: this.logger,
          phase: "verify",
          payload
        });
      }
      const response = await withTimeout(
        async (signal) =>
          fetch(`${this.verifierUrl.replace(/\/$/, "")}/verify`, {
            method: "POST",
            signal,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              ...(await this.authHeaders("verify"))
            },
            body: JSON.stringify(payload)
          }),
        this.timeoutMs
      );
      if (this.facilitatorProvider === "cdp") {
        logCdpExtensionResponses({
          logger: this.logger,
          phase: "verify",
          response,
          adapterTraceId
        });
      }

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
          facilitator_provider: this.facilitatorProvider,
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
        facilitator_provider: this.facilitatorProvider,
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
        facilitator_provider: this.facilitatorProvider,
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
      return { connected: true, mode: this.mode, facilitator_provider: this.facilitatorProvider, reason: "stub_mode" };
    }
    if (this.mode === "strict") {
      return {
        connected: Boolean(this.sharedSecret),
        mode: this.mode,
        facilitator_provider: this.facilitatorProvider,
        reason: this.sharedSecret ? "shared_secret_configured" : "missing_shared_secret"
      };
    }
    if (!this.verifierUrl) {
      return { connected: false, mode: this.mode, facilitator_provider: this.facilitatorProvider, reason: "missing_verifier_url" };
    }

    try {
      const readinessPath = this.facilitatorProvider === "cdp" ? "/supported" : "/health";
      const response = await withTimeout(
        async (signal) =>
          fetch(`${this.verifierUrl.replace(/\/$/, "")}${readinessPath}`, {
            method: "GET",
            signal,
            headers: {
              accept: "application/json",
              ...(await this.authHeaders(this.facilitatorProvider === "cdp" ? "supported" : "health")),
              ...(adapterTraceId ? { "x-adapter-trace-id": adapterTraceId } : {})
            }
          }),
        Math.min(this.timeoutMs, 3000)
      );
      return {
        connected: response.status < 500,
        mode: this.mode,
        facilitator_provider: this.facilitatorProvider,
        reason: `${this.facilitatorProvider === "cdp" ? "supported" : "health"}_status_${response.status}`
      };
    } catch {
      return {
        connected: false,
        mode: this.mode,
        facilitator_provider: this.facilitatorProvider,
        reason: "health_probe_failed"
      };
    }
  }

  async settle({ payment, adapterTraceId = null } = {}) {
    if (this.mode === "stub" || this.mode === "strict") {
      return { ok: true, skipped: true, reason: "mode_without_remote_settlement" };
    }
    if (this.facilitatorProvider !== "cdp") {
      return { ok: true, skipped: true, reason: "provider_without_remote_settlement" };
    }
    if (!this.verifierUrl) {
      return {
        ok: false,
        reason: "PAYMENT_VERIFICATION_FAILED",
        details: { message: "Verifier URL is missing for facilitator mode." }
      };
    }

    const { paymentPayload, paymentRequirements } = cdpV2PayloadPair(payment);
    if (!paymentPayload || !paymentRequirements) {
      return { ok: true, skipped: true, reason: "missing_native_payment_payload" };
    }
    const payload = cdpV2PhasePayload({ paymentPayload, paymentRequirements });
    logCdpFacilitatorPayloadShape({
      logger: this.logger,
      phase: "settle",
      payload
    });

    try {
      const response = await withTimeout(
        async (signal) =>
          fetch(`${this.verifierUrl.replace(/\/$/, "")}/settle`, {
            method: "POST",
            signal,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              ...(await this.authHeaders("settle")),
              ...(adapterTraceId ? { "x-adapter-trace-id": adapterTraceId } : {})
            },
            body: JSON.stringify(payload)
          }),
        this.timeoutMs
      );
      logCdpExtensionResponses({
        logger: this.logger,
        phase: "settle",
        response,
        adapterTraceId
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          reason: "PAYMENT_VERIFICATION_FAILED",
          details: { status: response.status, verifier_body: responseBody }
        };
      }
      return { ok: true, details: responseBody };
    } catch (error) {
      return {
        ok: false,
        reason: "PAYMENT_VERIFICATION_FAILED",
        details: { message: error?.message ?? "Settle request failed." }
      };
    }
  }

  async getReceiptStatus(reference, adapterTraceId) {
    if (!reference || !this.verifierUrl || this.mode === "stub" || this.facilitatorProvider === "cdp") {
      return null;
    }
    try {
      const response = await withTimeout(
        async (signal) =>
          fetch(`${this.verifierUrl.replace(/\/$/, "")}/receipts/${encodeURIComponent(reference)}`, {
            method: "GET",
            signal,
            headers: {
              accept: "application/json",
              ...(await this.authHeaders("receipts")),
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
