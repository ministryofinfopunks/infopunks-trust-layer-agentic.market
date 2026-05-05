import path from "node:path";
import { mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function normalizeNumber(value) {
  if (value == null || typeof value === "boolean") {
    return null;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeTimestamp(value) {
  if (!value) {
    return nowIso();
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return nowIso();
  }
  return new Date(parsed).toISOString();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeString(entry))
    .filter((entry) => entry !== null);
}

function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeX402Diagnostics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return {
    selected_payment_header: normalizeString(value.selected_payment_header) ?? "none",
    x_payment_present: normalizeBoolean(value.x_payment_present),
    payment_signature_present: normalizeBoolean(value.payment_signature_present),
    selected_header_bytes: normalizeNumber(value.selected_header_bytes),
    payment_payload_decode_success: normalizeBoolean(value.payment_payload_decode_success),
    decoded_payload_top_level_keys: normalizeStringArray(value.decoded_payload_top_level_keys),
    verify_requirement_keys: normalizeStringArray(value.verify_requirement_keys),
    has_amount: normalizeBoolean(value.has_amount),
    has_maxAmountRequired: normalizeBoolean(value.has_maxAmountRequired),
    amount_equals_maxAmountRequired: normalizeBoolean(value.amount_equals_maxAmountRequired),
    verify_resource: normalizeString(value.verify_resource),
    verify_network: normalizeString(value.verify_network),
    verify_asset: normalizeString(value.verify_asset),
    verify_payTo: normalizeString(value.verify_payTo),
    verify_price: normalizeString(value.verify_price),
    payment_accepted_keys: normalizeStringArray(value.payment_accepted_keys),
    payment_accepted_has_amount: normalizeBoolean(value.payment_accepted_has_amount),
    payment_accepted_has_maxAmountRequired: normalizeBoolean(value.payment_accepted_has_maxAmountRequired),
    payment_accepted_amount: normalizeString(value.payment_accepted_amount),
    payment_accepted_maxAmountRequired: normalizeString(value.payment_accepted_maxAmountRequired),
    payment_accepted_resource: normalizeString(value.payment_accepted_resource),
    payment_accepted_network: normalizeString(value.payment_accepted_network),
    payment_accepted_asset: normalizeString(value.payment_accepted_asset),
    payment_accepted_payTo: normalizeString(value.payment_accepted_payTo),
    payment_accepted_scheme: normalizeString(value.payment_accepted_scheme),
    accepted_resource_matches_verify_resource: normalizeBoolean(value.accepted_resource_matches_verify_resource),
    accepted_network_matches_verify_network: normalizeBoolean(value.accepted_network_matches_verify_network),
    accepted_asset_matches_verify_asset: normalizeBoolean(value.accepted_asset_matches_verify_asset),
    accepted_payTo_matches_verify_payTo: normalizeBoolean(value.accepted_payTo_matches_verify_payTo),
    accepted_amount_matches_verify_price: normalizeBoolean(value.accepted_amount_matches_verify_price),
    accepted_maxAmountRequired_matches_verify_price: normalizeBoolean(value.accepted_maxAmountRequired_matches_verify_price),
    cdp_payment_payload_keys: normalizeStringArray(value.cdp_payment_payload_keys),
    cdp_payment_payload_has_scheme: normalizeBoolean(value.cdp_payment_payload_has_scheme),
    cdp_payment_payload_scheme: normalizeString(value.cdp_payment_payload_scheme),
    cdp_payment_payload_network: normalizeString(value.cdp_payment_payload_network),
    cdp_payment_payload_stripped_wrapper_fields: normalizeBoolean(value.cdp_payment_payload_stripped_wrapper_fields),
    cdp_payment_payload_source: normalizeString(value.cdp_payment_payload_source),
    facilitator_provider: normalizeString(value.facilitator_provider),
    facilitator_verify_status: normalizeNumber(value.facilitator_verify_status),
    facilitator_verify_body_keys: normalizeStringArray(value.facilitator_verify_body_keys),
    facilitator_error_type: normalizeString(value.facilitator_error_type),
    facilitator_error_message: normalizeString(value.facilitator_error_message),
    facilitator_correlation_id: normalizeString(value.facilitator_correlation_id),
    facilitator_error_link: normalizeString(value.facilitator_error_link),
    facilitator_invalidReason: normalizeString(value.facilitator_invalidReason),
    facilitator_invalidMessage: normalizeString(value.facilitator_invalidMessage),
    sanitized_exception_name: normalizeString(value.sanitized_exception_name),
    sanitized_exception_message: normalizeString(value.sanitized_exception_message)
  };
}

function normalizeEvent(event = {}) {
  return {
    event_id: normalizeString(event.event_id) ?? `wre_${randomUUID()}`,
    event_type: normalizeString(event.event_type) ?? "paid_call.unknown",
    timestamp: normalizeTimestamp(event.timestamp),
    payer: normalizeString(event.payer),
    subject_id: normalizeString(event.subject_id),
    trust_score: normalizeNumber(event.trust_score),
    trust_tier: normalizeString(event.trust_tier),
    mode: normalizeString(event.mode),
    confidence: normalizeNumber(event.confidence),
    status: normalizeString(event.status),
    route: normalizeString(event.route),
    risk_level: normalizeString(event.risk_level),
    receipt_id: normalizeString(event.receipt_id),
    facilitator_provider: normalizeString(event.facilitator_provider),
    network: normalizeString(event.network),
    payTo: normalizeString(event.payTo ?? event.pay_to),
    price: normalizeString(event.price),
    amount: normalizeNumber(event.amount),
    error_code: normalizeString(event.error_code),
    reason: normalizeString(event.reason),
    bazaar_extension_status: normalizeString(event.bazaar_extension_status),
    bazaar_extension_reason: normalizeString(event.bazaar_extension_reason),
    bazaar_extension_raw: normalizeString(event.bazaar_extension_raw),
    x402_diagnostics: normalizeX402Diagnostics(event.x402_diagnostics)
  };
}

class JsonlWarRoomFeed {
  constructor({ filePath, logger }) {
    this.filePath = filePath;
    this.logger = logger;
    this.memory = [];
    mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  async record(event) {
    const normalized = normalizeEvent(event);
    this.memory.unshift(normalized);
    this.memory = this.memory.slice(0, 500);
    try {
      appendFileSync(this.filePath, `${JSON.stringify(normalized)}\n`, "utf8");
    } catch (error) {
      this.logger?.warn?.({
        event: "war_room_event_fallback_write_failed",
        message: error?.message ?? "unknown_error"
      });
    }
    return normalized;
  }

  async listLatest(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const lines = raw.trim().length > 0 ? raw.trim().split("\n") : [];
      const parsed = [];
      for (let index = lines.length - 1; index >= 0 && parsed.length < safeLimit; index -= 1) {
        try {
          parsed.push(normalizeEvent(JSON.parse(lines[index])));
        } catch {
          // Ignore malformed lines.
        }
      }
      if (parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Fall back to in-memory cache.
    }
    return this.memory.slice(0, safeLimit).map((entry) => normalizeEvent(entry));
  }
}

export function createWarRoomFeed({ store, config, logger }) {
  if (
    store
    && typeof store.recordWarRoomEvent === "function"
    && typeof store.listWarRoomEvents === "function"
  ) {
    return {
      async record(event) {
        return store.recordWarRoomEvent(normalizeEvent(event));
      },
      async listLatest(limit = 50) {
        return store.listWarRoomEvents(Math.max(1, Math.min(200, Number(limit) || 50)));
      }
    };
  }

  const fallbackPath = config.warRoomEventsFilePath
    ?? path.join(config.adapterRuntimeDir ?? process.cwd(), "war-room-events.jsonl");
  const fallback = new JsonlWarRoomFeed({ filePath: fallbackPath, logger });
  return {
    record: (event) => fallback.record(event),
    listLatest: (limit) => fallback.listLatest(limit)
  };
}
