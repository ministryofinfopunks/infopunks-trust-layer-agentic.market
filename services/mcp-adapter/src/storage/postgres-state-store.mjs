import { randomUUID } from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function dayPrefix(iso) {
  return String(iso).slice(0, 10);
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function fromJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toSqlText(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export class PostgresAdapterStateStore {
  constructor({ pool }) {
    this.pool = pool;
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS replay_nonces (
        nonce TEXT PRIMARY KEY,
        proof_id TEXT UNIQUE,
        session_id TEXT,
        payer TEXT,
        tool_name TEXT,
        first_seen_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        verifier_reference TEXT UNIQUE,
        payment_fingerprint TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_replay_expires_at ON replay_nonces(expires_at);

      CREATE TABLE IF NOT EXISTS payment_receipts (
        receipt_id TEXT PRIMARY KEY,
        verifier_reference TEXT UNIQUE,
        proof_id TEXT UNIQUE,
        session_id TEXT,
        payer TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        billed_units INTEGER NOT NULL,
        receipt_status TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        provisional_at TIMESTAMPTZ NOT NULL,
        settled_at TIMESTAMPTZ,
        reversed_at TIMESTAMPTZ,
        last_error TEXT,
        adapter_trace_id TEXT,
        internal_trace_id TEXT,
        metadata_json TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_payer_date ON payment_receipts(payer, provisional_at);
      CREATE INDEX IF NOT EXISTS idx_receipts_settlement ON payment_receipts(settlement_status);
      CREATE INDEX IF NOT EXISTS idx_receipts_trace ON payment_receipts(adapter_trace_id);

      CREATE TABLE IF NOT EXISTS tool_usage_ledger (
        usage_id TEXT PRIMARY KEY,
        adapter_trace_id TEXT UNIQUE,
        tool_name TEXT NOT NULL,
        payer TEXT,
        caller_subject_id TEXT,
        target_subject_id TEXT,
        billed_units INTEGER NOT NULL,
        receipt_id TEXT,
        usage_status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_usage_receipt ON tool_usage_ledger(receipt_id);
      CREATE INDEX IF NOT EXISTS idx_usage_tool ON tool_usage_ledger(tool_name);

      CREATE TABLE IF NOT EXISTS adapter_request_log (
        log_id TEXT PRIMARY KEY,
        adapter_trace_id TEXT,
        tool_name TEXT,
        status_code INTEGER,
        error_code TEXT,
        latency_ms INTEGER,
        billed_units INTEGER,
        receipt_id TEXT,
        internal_trace_id TEXT,
        details_json TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_request_trace ON adapter_request_log(adapter_trace_id);
      CREATE INDEX IF NOT EXISTS idx_request_tool_time ON adapter_request_log(tool_name, created_at);

      CREATE TABLE IF NOT EXISTS billing_ledger (
        ledger_id TEXT PRIMARY KEY,
        adapter_trace_id TEXT,
        request_id TEXT,
        tool_name TEXT NOT NULL,
        payer TEXT,
        subject_id TEXT,
        billed_units INTEGER NOT NULL,
        receipt_id TEXT,
        network TEXT,
        asset TEXT,
        price_atomic TEXT,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_ledger_receipt ON billing_ledger(receipt_id);
      CREATE INDEX IF NOT EXISTS idx_billing_ledger_created ON billing_ledger(created_at);

      CREATE TABLE IF NOT EXISTS entitlement_sessions (
        session_id TEXT PRIMARY KEY,
        token_jti TEXT UNIQUE,
        issuer TEXT,
        audience TEXT,
        token_subject TEXT,
        payer TEXT,
        scopes_json TEXT,
        issued_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_entitlement_jti ON entitlement_sessions(token_jti);
      CREATE INDEX IF NOT EXISTS idx_entitlement_exp ON entitlement_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS reconciliation_locks (
        lock_name TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS paid_idempotency (
        key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        status_code INTEGER,
        response_json TEXT,
        error_code TEXT,
        receipt_id TEXT,
        payer TEXT,
        subject_id TEXT,
        nonce TEXT,
        mode TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_paid_idempotency_created ON paid_idempotency(created_at);

      CREATE TABLE IF NOT EXISTS trust_cache (
        subject_id TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trust_cache_updated_at ON trust_cache(updated_at);

      CREATE TABLE IF NOT EXISTS war_room_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        payer TEXT,
        subject_id TEXT,
        trust_score DOUBLE PRECISION,
        trust_tier TEXT,
        mode TEXT,
        confidence DOUBLE PRECISION,
        status TEXT,
        route TEXT,
        risk_level TEXT,
        receipt_id TEXT,
        facilitator_provider TEXT,
        network TEXT,
        pay_to TEXT,
        price TEXT,
        amount DOUBLE PRECISION,
        error_code TEXT,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_war_room_events_timestamp ON war_room_events(timestamp DESC);
    `);

    for (const [column, type] of [
      ["route", "TEXT"],
      ["risk_level", "TEXT"],
      ["facilitator_provider", "TEXT"],
      ["network", "TEXT"],
      ["pay_to", "TEXT"],
      ["price", "TEXT"]
    ]) {
      await this.pool.query(`ALTER TABLE war_room_events ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    }
  }

  buildPaymentFingerprint({ nonce, proofId, sessionId, verifierReference, payer }) {
    if (verifierReference) {
      return `verifier:${verifierReference}`;
    }
    if (proofId) {
      return `proof:${proofId}`;
    }
    if (sessionId && nonce) {
      return `session_nonce:${sessionId}:${nonce}`;
    }
    if (nonce) {
      return `nonce:${nonce}`;
    }
    if (sessionId && payer) {
      return `session_payer:${sessionId}:${payer}`;
    }
    return null;
  }

  async getIdempotencyRecord(key) {
    if (!key) {
      return null;
    }
    const result = await this.pool.query(
      `
        SELECT key, request_hash, status_code, response_json, error_code, receipt_id, payer, subject_id,
               nonce, mode, created_at, updated_at
        FROM paid_idempotency
        WHERE key = $1
        LIMIT 1
      `,
      [key]
    );
    const row = result.rows[0];
    return row ? { ...row, response: fromJson(row.response_json, null) } : null;
  }

  async reserveIdempotencyKey({
    key,
    requestHash,
    payer,
    subjectId,
    nonce,
    mode
  }) {
    const now = nowIso();
    try {
      await this.pool.query(
        `
          INSERT INTO paid_idempotency (
            key, request_hash, status_code, response_json, error_code, receipt_id, payer, subject_id,
            nonce, mode, created_at, updated_at
          ) VALUES ($1, $2, NULL, NULL, NULL, NULL, $3, $4, $5, $6, $7, $7)
        `,
        [key, requestHash, payer ?? null, subjectId ?? null, nonce ?? null, mode ?? null, now]
      );
      return {
        ok: true,
        created: true,
        record: await this.getIdempotencyRecord(key)
      };
    } catch (error) {
      if (String(error?.code ?? "") !== "23505") {
        throw error;
      }
      const existing = await this.getIdempotencyRecord(key);
      if (!existing) {
        return {
          ok: false,
          reason: "IDEMPOTENCY_CONFLICT",
          details: { key, message: "idempotency_lookup_failed_after_conflict" }
        };
      }
      if (existing.request_hash !== requestHash) {
        return {
          ok: false,
          reason: "IDEMPOTENCY_CONFLICT",
          details: {
            key,
            existing_request_hash: existing.request_hash,
            request_hash: requestHash
          }
        };
      }
      return {
        ok: true,
        created: false,
        record: existing
      };
    }
  }

  async finalizeIdempotencyKey({
    key,
    statusCode,
    response,
    errorCode,
    receiptId
  }) {
    await this.pool.query(
      `
        UPDATE paid_idempotency
        SET status_code = $1, response_json = $2, error_code = $3, receipt_id = $4, updated_at = NOW()
        WHERE key = $5
      `,
      [statusCode ?? null, toJson(response ?? null), errorCode ?? null, receiptId ?? null, key]
    );
    return this.getIdempotencyRecord(key);
  }

  async getCachedTrustForSubject(subjectId) {
    if (!subjectId) {
      return null;
    }
    const result = await this.pool.query(
      `
        SELECT subject_id, response_json, updated_at
        FROM trust_cache
        WHERE subject_id = $1
        LIMIT 1
      `,
      [subjectId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      subject_id: row.subject_id,
      response: fromJson(row.response_json, null),
      updated_at: row.updated_at
    };
  }

  async setCachedTrustForSubject(subjectId, response) {
    if (!subjectId || !response || typeof response !== "object") {
      return;
    }
    await this.pool.query(
      `
        INSERT INTO trust_cache (subject_id, response_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT(subject_id) DO UPDATE SET
          response_json = EXCLUDED.response_json,
          updated_at = NOW()
      `,
      [subjectId, toJson(response)]
    );
  }

  async recordWarRoomEvent(event = {}) {
    const normalized = {
      event_id: event.event_id ?? `wre_${randomUUID()}`,
      event_type: event.event_type ?? "paid_call.unknown",
      timestamp: event.timestamp ?? nowIso(),
      payer: event.payer ?? null,
      subject_id: event.subject_id ?? null,
      trust_score: Number.isFinite(Number(event.trust_score)) ? Number(event.trust_score) : null,
      trust_tier: event.trust_tier ?? null,
      mode: event.mode ?? null,
      confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : null,
      status: event.status ?? null,
      route: event.route ?? null,
      risk_level: event.risk_level ?? null,
      receipt_id: event.receipt_id ?? null,
      facilitator_provider: event.facilitator_provider ?? null,
      network: event.network ?? null,
      payTo: event.payTo ?? event.pay_to ?? null,
      price: event.price ?? null,
      amount: Number.isFinite(Number(event.amount)) ? Number(event.amount) : null,
      error_code: event.error_code ?? null,
      reason: event.reason ?? null
    };

    await this.pool.query(
      `
        INSERT INTO war_room_events (
          event_id, event_type, timestamp, payer, subject_id, trust_score, trust_tier,
          mode, confidence, status, route, risk_level, receipt_id, facilitator_provider,
          network, pay_to, price, amount, error_code, reason
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      `,
      [
        normalized.event_id,
        normalized.event_type,
        normalized.timestamp,
        normalized.payer,
        normalized.subject_id,
        normalized.trust_score,
        normalized.trust_tier,
        normalized.mode,
        normalized.confidence,
        normalized.status,
        normalized.route,
        normalized.risk_level,
        normalized.receipt_id,
        normalized.facilitator_provider,
        normalized.network,
        normalized.payTo,
        normalized.price,
        normalized.amount,
        normalized.error_code,
        normalized.reason
      ]
    );

    return normalized;
  }

  async listWarRoomEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const result = await this.pool.query(
      `
        SELECT event_id, event_type, timestamp, payer, subject_id, trust_score, trust_tier,
               mode, confidence, status, route, risk_level, receipt_id, facilitator_provider,
               network, pay_to, price, amount, error_code, reason
        FROM war_room_events
        ORDER BY timestamp DESC
        LIMIT $1
      `,
      [safeLimit]
    );
    return result.rows;
  }

  async spendState(payer) {
    const today = dayPrefix(nowIso());
    const spend = await this.pool.query(
      `
        SELECT COALESCE(SUM(billed_units), 0) AS units
        FROM payment_receipts
        WHERE payer = $1
          AND TO_CHAR(provisional_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $2
          AND receipt_status IN ('verified', 'settled', 'provisional')
      `,
      [payer, today]
    );
    const recent = await this.pool.query(
      `
        SELECT receipt_id, verifier_reference, proof_id, session_id, payer, tool_name,
               billed_units, receipt_status, settlement_status, provisional_at, settled_at, reversed_at
        FROM payment_receipts
        WHERE payer = $1
        ORDER BY provisional_at DESC
        LIMIT 10
      `,
      [payer]
    );
    return {
      day: today,
      payer,
      units_spent_today: Number(spend.rows[0]?.units ?? 0),
      recent_receipts: recent.rows
    };
  }

  async findReplayExisting({ nonce, proofId, verifierReference, paymentFingerprint }, executor = this.pool) {
    if (nonce) {
      const row = await executor.query(`SELECT * FROM replay_nonces WHERE nonce = $1 LIMIT 1`, [nonce]);
      if (row.rows[0]) {
        return row.rows[0];
      }
    }
    if (proofId) {
      const row = await executor.query(`SELECT * FROM replay_nonces WHERE proof_id = $1 LIMIT 1`, [proofId]);
      if (row.rows[0]) {
        return row.rows[0];
      }
    }
    if (verifierReference) {
      const row = await executor.query(`SELECT * FROM replay_nonces WHERE verifier_reference = $1 LIMIT 1`, [verifierReference]);
      if (row.rows[0]) {
        return row.rows[0];
      }
    }
    if (paymentFingerprint) {
      const row = await executor.query(`SELECT * FROM replay_nonces WHERE payment_fingerprint = $1 LIMIT 1`, [paymentFingerprint]);
      if (row.rows[0]) {
        return row.rows[0];
      }
    }
    return null;
  }

  async assertNotReplay({ nonce, proofId, sessionId, payer, toolName, replayWindowSeconds, verifierReference }, executor = this.pool) {
    const now = nowIso();
    await executor.query(`DELETE FROM replay_nonces WHERE expires_at < NOW()`);
    const paymentFingerprint = this.buildPaymentFingerprint({ nonce, proofId, sessionId, verifierReference, payer });
    if (!paymentFingerprint) {
      return {
        ok: false,
        reason: "PAYMENT_VERIFICATION_FAILED",
        details: {
          message: "Replay identity missing: expected nonce/proof_id/verifier_reference/session_id+payer.",
          nonce: nonce ?? null,
          proof_id: proofId ?? null,
          verifier_reference: verifierReference ?? null,
          session_id: sessionId ?? null
        }
      };
    }

    const expiry = new Date(Date.now() + replayWindowSeconds * 1000).toISOString();
    const replayNonce = nonce ?? `fp_${paymentFingerprint}`;
    try {
      await executor.query(
        `
          INSERT INTO replay_nonces (
            nonce, proof_id, session_id, payer, tool_name, first_seen_at, expires_at, verifier_reference, payment_fingerprint
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [replayNonce, proofId ?? null, sessionId ?? null, payer ?? null, toolName ?? null, now, expiry, verifierReference ?? null, paymentFingerprint]
      );
      return { ok: true, expires_at: expiry };
    } catch (error) {
      if (String(error?.code ?? "") === "23505") {
        return {
          ok: false,
          reason: "PAYMENT_REPLAY_DETECTED",
          details: {
            nonce: nonce ?? null,
            proof_id: proofId ?? null,
            session_id: sessionId ?? null,
            verifier_reference: verifierReference ?? null,
            payment_fingerprint: paymentFingerprint
          }
        };
      }
      throw error;
    }
  }

  async reservePaidOperation({
    nonce,
    proofId,
    sessionId,
    payer,
    toolName,
    replayWindowSeconds,
    verifierReference,
    billedUnits,
    adapterTraceId,
    metadata,
    spendLimitUnits
  }) {
    const client = await this.pool.connect();
    const now = nowIso();
    const receiptId = `xrc_${randomUUID()}`;
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM replay_nonces WHERE expires_at < NOW()`);
      const replay = await this.assertNotReplay({
        nonce,
        proofId,
        sessionId,
        payer,
        toolName,
        replayWindowSeconds,
        verifierReference
      }, client);
      if (!replay.ok) {
        await client.query("ROLLBACK");
        return replay;
      }
      const today = dayPrefix(now);
      const spend = await client.query(
        `
          SELECT COALESCE(SUM(billed_units), 0) AS units
          FROM payment_receipts
          WHERE payer = $1
            AND TO_CHAR(provisional_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $2
            AND receipt_status IN ('verified', 'settled', 'provisional')
        `,
        [payer, today]
      );
      const currentUnits = Number(spend.rows[0]?.units ?? 0);
      const projected = currentUnits + billedUnits;
      if (projected > spendLimitUnits) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          reason: "ENTITLEMENT_REQUIRED",
          details: {
            payer,
            current_units: currentUnits,
            projected_units: projected,
            limit_units: spendLimitUnits,
            required_units: billedUnits,
            operation: toolName
          }
        };
      }
      await client.query(
        `
          INSERT INTO payment_receipts (
            receipt_id, verifier_reference, proof_id, session_id, payer, tool_name, billed_units,
            receipt_status, settlement_status, provisional_at, settled_at, reversed_at,
            last_error, adapter_trace_id, internal_trace_id, metadata_json, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,NULL,$11,NULL,$12,$10)
        `,
        [
          receiptId,
          verifierReference ?? null,
          proofId ?? null,
          sessionId ?? null,
          payer,
          toolName,
          billedUnits,
          "verified",
          "provisional",
          now,
          adapterTraceId ?? null,
          toJson(metadata)
        ]
      );
      await client.query("COMMIT");
      return {
        ok: true,
        receipt: {
          receipt_id: receiptId,
          verifier_reference: verifierReference ?? null,
          proof_id: proofId ?? null,
          session_id: sessionId ?? null,
          payer,
          tool_name: toolName,
          units_charged: billedUnits,
          receipt_status: "verified",
          settlement_status: "provisional",
          provisional_at: now
        }
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (String(error?.code ?? "") === "23505") {
        return {
          ok: false,
          reason: "PAYMENT_REPLAY_DETECTED",
          details: {
            nonce: nonce ?? null,
            proof_id: proofId ?? null,
            session_id: sessionId ?? null,
            verifier_reference: verifierReference ?? null
          }
        };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async createProvisionalReceipt({ verifierReference, proofId, sessionId, payer, toolName, billedUnits, adapterTraceId, metadata }) {
    const receiptId = `xrc_${randomUUID()}`;
    const now = nowIso();
    try {
      await this.pool.query(
        `
          INSERT INTO payment_receipts (
            receipt_id, verifier_reference, proof_id, session_id, payer, tool_name, billed_units,
            receipt_status, settlement_status, provisional_at, settled_at, reversed_at,
            last_error, adapter_trace_id, internal_trace_id, metadata_json, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,NULL,$11,NULL,$12,$10)
        `,
        [
          receiptId,
          verifierReference ?? null,
          proofId ?? null,
          sessionId ?? null,
          payer,
          toolName,
          billedUnits,
          "verified",
          "provisional",
          now,
          adapterTraceId ?? null,
          toJson(metadata)
        ]
      );
    } catch (error) {
      if (String(error?.code ?? "") === "23505") {
        const existing = (verifierReference ? await this.getReceiptByVerifierReference(verifierReference) : null)
          ?? (proofId ? await this.getReceiptByProofId(proofId) : null);
        if (existing) {
          return {
            receipt_id: existing.receipt_id,
            verifier_reference: existing.verifier_reference ?? null,
            proof_id: existing.proof_id ?? null,
            session_id: existing.session_id ?? null,
            payer: existing.payer,
            tool_name: existing.tool_name,
            units_charged: Number(existing.billed_units ?? 0),
            receipt_status: existing.receipt_status,
            settlement_status: existing.settlement_status,
            provisional_at: existing.provisional_at
          };
        }
      }
      throw error;
    }
    return {
      receipt_id: receiptId,
      verifier_reference: verifierReference ?? null,
      proof_id: proofId ?? null,
      session_id: sessionId ?? null,
      payer,
      tool_name: toolName,
      units_charged: billedUnits,
      receipt_status: "verified",
      settlement_status: "provisional",
      provisional_at: now
    };
  }

  async setReceiptInternalTrace(receiptId, internalTraceId) {
    await this.pool.query(
      `UPDATE payment_receipts SET internal_trace_id = $1, updated_at = NOW() WHERE receipt_id = $2`,
      [internalTraceId ?? null, receiptId]
    );
  }

  async getReceiptById(receiptId) {
    if (!receiptId) {
      return null;
    }
    const result = await this.pool.query(`SELECT * FROM payment_receipts WHERE receipt_id = $1 LIMIT 1`, [receiptId]);
    const row = result.rows[0];
    return row ? { ...row, metadata: fromJson(row.metadata_json, {}) } : null;
  }

  async getReceiptByVerifierReference(verifierReference) {
    if (!verifierReference) {
      return null;
    }
    const result = await this.pool.query(`SELECT * FROM payment_receipts WHERE verifier_reference = $1 LIMIT 1`, [verifierReference]);
    const row = result.rows[0];
    return row ? { ...row, metadata: fromJson(row.metadata_json, {}) } : null;
  }

  async getReceiptByProofId(proofId) {
    if (!proofId) {
      return null;
    }
    const result = await this.pool.query(`SELECT * FROM payment_receipts WHERE proof_id = $1 LIMIT 1`, [proofId]);
    const row = result.rows[0];
    return row ? { ...row, metadata: fromJson(row.metadata_json, {}) } : null;
  }

  async updateReceiptSettlement({ receiptId, verifierReference, receiptStatus, settlementStatus, settledAt, reversedAt, lastError }) {
    const current = receiptId ? await this.getReceiptById(receiptId) : await this.getReceiptByVerifierReference(verifierReference);
    if (!current) {
      return { updated: false, reason: "RECEIPT_NOT_FOUND" };
    }
    const currentSettlement = String(current.settlement_status ?? "provisional").toLowerCase();
    const nextSettlement = String(settlementStatus ?? currentSettlement).toLowerCase();

    if (currentSettlement === "reversed" && nextSettlement !== "reversed") {
      return { updated: false, reason: "TERMINAL_REVERSED" };
    }
    if (currentSettlement === "settled" && !["settled", "reversed"].includes(nextSettlement)) {
      return { updated: false, reason: "INVALID_SETTLED_DOWNGRADE" };
    }
    if (currentSettlement === "failed" && nextSettlement === "provisional") {
      return { updated: false, reason: "INVALID_FAILED_DOWNGRADE" };
    }

    const normalizedSettledAt = currentSettlement === nextSettlement ? (current.settled_at ?? null) : (settledAt ?? null);
    const normalizedReversedAt = currentSettlement === nextSettlement ? (current.reversed_at ?? null) : (reversedAt ?? null);
    const normalizedLastError = currentSettlement === nextSettlement ? (current.last_error ?? null) : (lastError ?? null);

    const changed = current.receipt_status !== receiptStatus
      || current.settlement_status !== settlementStatus
      || (current.settled_at ?? null) !== normalizedSettledAt
      || (current.reversed_at ?? null) !== normalizedReversedAt
      || (current.last_error ?? null) !== normalizedLastError;
    if (!changed) {
      return { updated: false, reason: "NOOP" };
    }

    const args = [
      receiptStatus,
      settlementStatus,
      normalizedSettledAt,
      normalizedReversedAt,
      normalizedLastError
    ];
    const query = receiptId
      ? `UPDATE payment_receipts SET receipt_status=$1, settlement_status=$2, settled_at=$3, reversed_at=$4, last_error=$5, updated_at=NOW() WHERE receipt_id=$6`
      : `UPDATE payment_receipts SET receipt_status=$1, settlement_status=$2, settled_at=$3, reversed_at=$4, last_error=$5, updated_at=NOW() WHERE verifier_reference=$6`;
    const lookup = receiptId ?? verifierReference;
    const result = await this.pool.query(query, [...args, lookup]);
    return { updated: Number(result.rowCount ?? 0) > 0 };
  }

  async recordToolUsage({ adapterTraceId, toolName, payer, callerSubjectId, targetSubjectId, billedUnits, receiptId, usageStatus }) {
    try {
      await this.pool.query(
        `
          INSERT INTO tool_usage_ledger (
            usage_id, adapter_trace_id, tool_name, payer, caller_subject_id, target_subject_id,
            billed_units, receipt_id, usage_status, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          `use_${randomUUID()}`,
          adapterTraceId ?? null,
          toolName,
          payer ?? null,
          callerSubjectId ?? null,
          targetSubjectId ?? null,
          billedUnits,
          receiptId ?? null,
          usageStatus,
          nowIso()
        ]
      );
    } catch (error) {
      if (String(error?.code ?? "") !== "23505") {
        throw error;
      }
      await this.updateUsageStatus(adapterTraceId, usageStatus);
    }
  }

  async updateUsageStatus(adapterTraceId, usageStatus) {
    if (!adapterTraceId) {
      return;
    }
    await this.pool.query(
      `UPDATE tool_usage_ledger SET usage_status = $1, updated_at = NOW() WHERE adapter_trace_id = $2`,
      [usageStatus, adapterTraceId]
    );
  }

  async listUnsettledReceipts(limit = 100) {
    const result = await this.pool.query(
      `
        SELECT * FROM payment_receipts
        WHERE settlement_status IN ('pending', 'provisional')
        ORDER BY provisional_at ASC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows.map((row) => ({ ...row, metadata: fromJson(row.metadata_json, {}) }));
  }

  async recordRequestLog({ adapterTraceId, toolName, statusCode, errorCode, latencyMs, billedUnits, receiptId, internalTraceId, details }) {
    await this.pool.query(
      `
        INSERT INTO adapter_request_log (
          log_id, adapter_trace_id, tool_name, status_code, error_code, latency_ms,
          billed_units, receipt_id, internal_trace_id, details_json, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        `log_${randomUUID()}`,
        adapterTraceId ?? null,
        toolName ?? null,
        statusCode ?? null,
        errorCode ?? null,
        latencyMs ?? null,
        billedUnits ?? null,
        receiptId ?? null,
        internalTraceId ?? null,
        toJson(details),
        nowIso()
      ]
    );
  }

  async recordBillingLedgerEntry({
    adapterTraceId,
    requestId = null,
    toolName,
    payer,
    subjectId,
    billedUnits,
    receiptId,
    network,
    asset,
    priceAtomic,
    status = "paid"
  }) {
    await this.pool.query(
      `
        INSERT INTO billing_ledger (
          ledger_id, adapter_trace_id, request_id, tool_name, payer, subject_id,
          billed_units, receipt_id, network, asset, price_atomic, status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `,
      [
        `bill_${randomUUID()}`,
        adapterTraceId ?? null,
        requestId ?? null,
        toolName,
        payer ?? null,
        subjectId ?? null,
        billedUnits ?? 0,
        receiptId ?? null,
        network ?? null,
        asset ?? null,
        priceAtomic != null ? String(priceAtomic) : null,
        status,
        nowIso()
      ]
    );
  }

  async upsertEntitlementSession(session) {
    await this.pool.query(
      `
        INSERT INTO entitlement_sessions (
          session_id, token_jti, issuer, audience, token_subject, payer, scopes_json,
          issued_at, expires_at, created_at, last_seen_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(session_id) DO UPDATE SET
          token_jti = EXCLUDED.token_jti,
          issuer = EXCLUDED.issuer,
          audience = EXCLUDED.audience,
          token_subject = EXCLUDED.token_subject,
          payer = EXCLUDED.payer,
          scopes_json = EXCLUDED.scopes_json,
          issued_at = EXCLUDED.issued_at,
          expires_at = EXCLUDED.expires_at,
          last_seen_at = EXCLUDED.last_seen_at
      `,
      [
        session.session_id,
        toSqlText(session.token_jti),
        toSqlText(session.issuer),
        toSqlText(session.audience),
        toSqlText(session.token_subject),
        toSqlText(session.payer),
        toJson(session.scopes ?? []),
        toSqlText(session.issued_at),
        toSqlText(session.expires_at),
        toSqlText(session.created_at) ?? nowIso(),
        nowIso()
      ]
    );
  }

  async getEntitlementSessionById(sessionId) {
    const result = await this.pool.query(`SELECT * FROM entitlement_sessions WHERE session_id = $1 LIMIT 1`, [sessionId]);
    const row = result.rows[0];
    return row ? { ...row, scopes: fromJson(row.scopes_json, []) } : null;
  }

  async getEntitlementSessionByJti(jti) {
    const result = await this.pool.query(`SELECT * FROM entitlement_sessions WHERE token_jti = $1 LIMIT 1`, [jti]);
    const row = result.rows[0];
    return row ? { ...row, scopes: fromJson(row.scopes_json, []) } : null;
  }

  async acquireLock(lockName, ownerId, ttlSeconds = 30) {
    const now = new Date();
    const nowIsoValue = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const result = await this.pool.query(
      `
        INSERT INTO reconciliation_locks (lock_name, owner_id, expires_at, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(lock_name) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
        WHERE reconciliation_locks.expires_at < EXCLUDED.updated_at
        RETURNING owner_id
      `,
      [lockName, ownerId, expiresAt, nowIsoValue]
    );
    return result.rows[0]?.owner_id === ownerId;
  }

  async releaseLock(lockName, ownerId) {
    await this.pool.query(`DELETE FROM reconciliation_locks WHERE lock_name = $1 AND owner_id = $2`, [lockName, ownerId]);
  }

  async renewLock(lockName, ownerId, ttlSeconds = 30) {
    const now = new Date();
    const nowIsoValue = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const result = await this.pool.query(
      `
        UPDATE reconciliation_locks
        SET expires_at = $1, updated_at = $2
        WHERE lock_name = $3 AND owner_id = $4 AND expires_at >= $5
      `,
      [expiresAt, nowIsoValue, lockName, ownerId, nowIsoValue]
    );
    return Number(result.rowCount ?? 0) > 0;
  }
}
