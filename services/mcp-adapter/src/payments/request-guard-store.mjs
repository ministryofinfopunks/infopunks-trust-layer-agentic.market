function fromTimestamp(value) {
  const date = new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export class InMemoryPaidRequestGuardStore {
  constructor() {
    this.records = new Map();
  }

  async getIdempotencyRecord(key) {
    return this.records.get(String(key)) ?? null;
  }

  async reserveIdempotencyKey({ key, requestHash, payer, subjectId, nonce, mode }) {
    const normalizedKey = String(key);
    const existing = this.records.get(normalizedKey);
    if (!existing) {
      const now = fromTimestamp(Date.now());
      const record = {
        key: normalizedKey,
        request_hash: requestHash,
        status_code: null,
        response_json: null,
        response: null,
        error_code: null,
        receipt_id: null,
        payer: payer ?? null,
        subject_id: subjectId ?? null,
        nonce: nonce ?? null,
        mode: mode ?? null,
        created_at: now,
        updated_at: now
      };
      this.records.set(normalizedKey, record);
      return { ok: true, created: true, record };
    }

    if (existing.request_hash !== requestHash) {
      return {
        ok: false,
        reason: "IDEMPOTENCY_CONFLICT",
        details: {
          key: normalizedKey,
          existing_request_hash: existing.request_hash,
          request_hash: requestHash
        }
      };
    }

    return { ok: true, created: false, record: existing };
  }

  async finalizeIdempotencyKey({ key, statusCode, response, errorCode, receiptId }) {
    const normalizedKey = String(key);
    const existing = this.records.get(normalizedKey);
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      status_code: statusCode ?? null,
      response_json: JSON.stringify(response ?? null),
      response: response ?? null,
      error_code: errorCode ?? null,
      receipt_id: receiptId ?? null,
      updated_at: fromTimestamp(Date.now())
    };
    this.records.set(normalizedKey, updated);
    return updated;
  }
}

export function resolvePaidRequestGuardStore({ store, config, logger }) {
  const hasPersistentInterface = store
    && typeof store.getIdempotencyRecord === "function"
    && typeof store.reserveIdempotencyKey === "function"
    && typeof store.finalizeIdempotencyKey === "function";
  if (hasPersistentInterface) {
    return store;
  }

  const environment = String(config?.environment ?? "local");
  if (environment === "local" || environment === "test") {
    logger?.warn?.({
      event: "paid_request_guard_fallback_in_memory",
      message: "State store does not support idempotency persistence; using in-memory fallback for local/test."
    });
    return new InMemoryPaidRequestGuardStore();
  }

  throw new Error(
    "Paid request guard persistence is required in non-local environments. Missing idempotency storage adapter methods."
  );
}
