import path from "node:path";
import { mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function normalizeNumber(value) {
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
    reason: normalizeString(event.reason)
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
