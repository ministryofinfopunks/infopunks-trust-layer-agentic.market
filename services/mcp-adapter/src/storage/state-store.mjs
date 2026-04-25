import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

export class AdapterStateStore {
  constructor({ dbPath }) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.initSchema();

    this.stmt = {
      insertReplayNonce: this.db.prepare(`
        INSERT INTO replay_nonces (
          nonce, proof_id, session_id, payer, tool_name, first_seen_at, expires_at, verifier_reference, payment_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      findReplayByNonce: this.db.prepare(`
        SELECT nonce, proof_id, session_id, payer, tool_name, first_seen_at, expires_at, verifier_reference
        FROM replay_nonces
        WHERE nonce = ?
      `),
      findReplayByProofId: this.db.prepare(`
        SELECT nonce, proof_id, session_id, payer, tool_name, first_seen_at, expires_at, verifier_reference
        FROM replay_nonces
        WHERE proof_id = ?
      `),
      findReplayByVerifierRef: this.db.prepare(`
        SELECT nonce, proof_id, session_id, payer, tool_name, first_seen_at, expires_at, verifier_reference
        FROM replay_nonces
        WHERE verifier_reference = ?
      `),
      findReplayByFingerprint: this.db.prepare(`
        SELECT nonce, proof_id, session_id, payer, tool_name, first_seen_at, expires_at, verifier_reference
        FROM replay_nonces
        WHERE payment_fingerprint = ?
      `),
      deleteExpiredReplay: this.db.prepare(`DELETE FROM replay_nonces WHERE expires_at < ?`),

      insertReceipt: this.db.prepare(`
        INSERT INTO payment_receipts (
          receipt_id, verifier_reference, proof_id, session_id, payer, tool_name, billed_units,
          receipt_status, settlement_status, provisional_at, settled_at, reversed_at,
          last_error, adapter_trace_id, internal_trace_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateReceiptStatusById: this.db.prepare(`
        UPDATE payment_receipts
        SET receipt_status = ?, settlement_status = ?, settled_at = ?, reversed_at = ?, last_error = ?, updated_at = ?
        WHERE receipt_id = ?
      `),
      updateReceiptStatusByVerifierRef: this.db.prepare(`
        UPDATE payment_receipts
        SET receipt_status = ?, settlement_status = ?, settled_at = ?, reversed_at = ?, last_error = ?, updated_at = ?
        WHERE verifier_reference = ?
      `),
      setReceiptInternalTrace: this.db.prepare(`
        UPDATE payment_receipts
        SET internal_trace_id = ?, updated_at = ?
        WHERE receipt_id = ?
      `),
      getReceiptById: this.db.prepare(`
        SELECT receipt_id, verifier_reference, proof_id, session_id, payer, tool_name, billed_units,
               receipt_status, settlement_status, provisional_at, settled_at, reversed_at, last_error,
               adapter_trace_id, internal_trace_id, metadata_json, updated_at
        FROM payment_receipts
        WHERE receipt_id = ?
      `),
      getReceiptByVerifierRef: this.db.prepare(`
        SELECT receipt_id, verifier_reference, proof_id, session_id, payer, tool_name, billed_units,
               receipt_status, settlement_status, provisional_at, settled_at, reversed_at, last_error,
               adapter_trace_id, internal_trace_id, metadata_json, updated_at
        FROM payment_receipts
        WHERE verifier_reference = ?
      `),
      getReceiptByProofId: this.db.prepare(`
        SELECT receipt_id, verifier_reference, proof_id, session_id, payer, tool_name, billed_units,
               receipt_status, settlement_status, provisional_at, settled_at, reversed_at, last_error,
               adapter_trace_id, internal_trace_id, metadata_json, updated_at
        FROM payment_receipts
        WHERE proof_id = ?
      `),
      listUnsettledReceipts: this.db.prepare(`
        SELECT receipt_id, verifier_reference, proof_id, session_id, payer, tool_name, billed_units,
               receipt_status, settlement_status, provisional_at, settled_at, reversed_at,
               last_error, adapter_trace_id, internal_trace_id, metadata_json
        FROM payment_receipts
        WHERE settlement_status IN ('pending', 'provisional')
        ORDER BY provisional_at ASC
        LIMIT ?
      `),

      insertUsage: this.db.prepare(`
        INSERT INTO tool_usage_ledger (
          usage_id, adapter_trace_id, tool_name, payer, caller_subject_id, target_subject_id,
          billed_units, receipt_id, usage_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateUsageStatusByTrace: this.db.prepare(`
        UPDATE tool_usage_ledger
        SET usage_status = ?, updated_at = ?
        WHERE adapter_trace_id = ?
      `),

      insertRequestLog: this.db.prepare(`
        INSERT INTO adapter_request_log (
          log_id, adapter_trace_id, tool_name, status_code, error_code, latency_ms,
          billed_units, receipt_id, internal_trace_id, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertBillingLedger: this.db.prepare(`
        INSERT INTO billing_ledger (
          ledger_id, adapter_trace_id, request_id, tool_name, payer, subject_id,
          billed_units, receipt_id, network, asset, price_atomic, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      spendByDay: this.db.prepare(`
        SELECT COALESCE(SUM(billed_units), 0) AS units
        FROM payment_receipts
        WHERE payer = ?
          AND substr(provisional_at, 1, 10) = ?
          AND receipt_status IN ('verified', 'settled', 'provisional')
      `),
      recentReceipts: this.db.prepare(`
        SELECT receipt_id, verifier_reference, proof_id, session_id, payer, tool_name,
               billed_units, receipt_status, settlement_status, provisional_at, settled_at, reversed_at
        FROM payment_receipts
        WHERE payer = ?
        ORDER BY provisional_at DESC
        LIMIT ?
      `),

      upsertEntitlementSession: this.db.prepare(`
        INSERT INTO entitlement_sessions (
          session_id, token_jti, issuer, audience, token_subject, payer, scopes_json,
          issued_at, expires_at, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          token_jti = excluded.token_jti,
          issuer = excluded.issuer,
          audience = excluded.audience,
          token_subject = excluded.token_subject,
          payer = excluded.payer,
          scopes_json = excluded.scopes_json,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at,
          last_seen_at = excluded.last_seen_at
      `),
      getEntitlementSession: this.db.prepare(`
        SELECT session_id, token_jti, issuer, audience, token_subject, payer,
               scopes_json, issued_at, expires_at, created_at, last_seen_at
        FROM entitlement_sessions
        WHERE session_id = ?
      `),
      getEntitlementByJti: this.db.prepare(`
        SELECT session_id, token_jti, issuer, audience, token_subject, payer,
               scopes_json, issued_at, expires_at, created_at, last_seen_at
        FROM entitlement_sessions
        WHERE token_jti = ?
      `),

      acquireLockInsert: this.db.prepare(`
        INSERT INTO distributed_locks (lock_name, owner_id, expires_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(lock_name) DO UPDATE SET
          owner_id = excluded.owner_id,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
        WHERE distributed_locks.expires_at < excluded.updated_at
      `),
      getLock: this.db.prepare(`SELECT lock_name, owner_id, expires_at, updated_at FROM distributed_locks WHERE lock_name = ?`),
      renewLock: this.db.prepare(`
        UPDATE distributed_locks
        SET expires_at = ?, updated_at = ?
        WHERE lock_name = ? AND owner_id = ? AND expires_at >= ?
      `),
      releaseLock: this.db.prepare(`DELETE FROM distributed_locks WHERE lock_name = ? AND owner_id = ?`)
      ,
      getPaidIdempotency: this.db.prepare(`
        SELECT key, request_hash, status_code, response_json, error_code, receipt_id, payer, subject_id,
               nonce, mode, created_at, updated_at
        FROM paid_idempotency
        WHERE key = ?
      `),
      insertPaidIdempotency: this.db.prepare(`
        INSERT INTO paid_idempotency (
          key, request_hash, status_code, response_json, error_code, receipt_id, payer, subject_id,
          nonce, mode, created_at, updated_at
        ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
      `),
      updatePaidIdempotency: this.db.prepare(`
        UPDATE paid_idempotency
        SET status_code = ?, response_json = ?, error_code = ?, receipt_id = ?, updated_at = ?
        WHERE key = ?
      `),
      getTrustCache: this.db.prepare(`
        SELECT subject_id, response_json, updated_at
        FROM trust_cache
        WHERE subject_id = ?
      `),
      upsertTrustCache: this.db.prepare(`
        INSERT INTO trust_cache (subject_id, response_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(subject_id) DO UPDATE SET
          response_json = excluded.response_json,
          updated_at = excluded.updated_at
      `),
      insertWarRoomEvent: this.db.prepare(`
        INSERT INTO war_room_events (
          event_id, event_type, timestamp, payer, subject_id, trust_score, trust_tier,
          mode, confidence, status, receipt_id, amount, error_code, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      listWarRoomEvents: this.db.prepare(`
        SELECT event_id, event_type, timestamp, payer, subject_id, trust_score, trust_tier,
               mode, confidence, status, receipt_id, amount, error_code, reason
        FROM war_room_events
        ORDER BY timestamp DESC
        LIMIT ?
      `)
    };
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS replay_nonces (
        nonce TEXT PRIMARY KEY,
        proof_id TEXT,
        session_id TEXT,
        payer TEXT,
        tool_name TEXT,
        first_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        verifier_reference TEXT,
        payment_fingerprint TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_replay_proof_id ON replay_nonces(proof_id);
      CREATE INDEX IF NOT EXISTS idx_replay_expires_at ON replay_nonces(expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_proof_id_nonnull ON replay_nonces(proof_id) WHERE proof_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_verifier_reference_nonnull ON replay_nonces(verifier_reference) WHERE verifier_reference IS NOT NULL;

      CREATE TABLE IF NOT EXISTS payment_receipts (
        receipt_id TEXT PRIMARY KEY,
        verifier_reference TEXT,
        proof_id TEXT,
        session_id TEXT,
        payer TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        billed_units INTEGER NOT NULL,
        receipt_status TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        provisional_at TEXT NOT NULL,
        settled_at TEXT,
        reversed_at TEXT,
        last_error TEXT,
        adapter_trace_id TEXT,
        internal_trace_id TEXT,
        metadata_json TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(verifier_reference)
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_payer_date ON payment_receipts(payer, provisional_at);
      CREATE INDEX IF NOT EXISTS idx_receipts_settlement ON payment_receipts(settlement_status);
      CREATE INDEX IF NOT EXISTS idx_receipts_trace ON payment_receipts(adapter_trace_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_proof_id_nonnull ON payment_receipts(proof_id) WHERE proof_id IS NOT NULL;

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
        created_at TEXT NOT NULL,
        updated_at TEXT
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
        created_at TEXT NOT NULL
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
        created_at TEXT NOT NULL
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
        issued_at TEXT,
        expires_at TEXT,
        created_at TEXT,
        last_seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entitlement_jti ON entitlement_sessions(token_jti);
      CREATE INDEX IF NOT EXISTS idx_entitlement_exp ON entitlement_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS distributed_locks (
        lock_name TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_paid_idempotency_created ON paid_idempotency(created_at);

      CREATE TABLE IF NOT EXISTS trust_cache (
        subject_id TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trust_cache_updated_at ON trust_cache(updated_at);

      CREATE TABLE IF NOT EXISTS war_room_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payer TEXT,
        subject_id TEXT,
        trust_score REAL,
        trust_tier TEXT,
        mode TEXT,
        confidence REAL,
        status TEXT,
        receipt_id TEXT,
        amount REAL,
        error_code TEXT,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_war_room_events_timestamp ON war_room_events(timestamp DESC);
    `);

    // Migration-safe: add column first on upgraded stores, then create index.
    try {
      this.db.exec(`ALTER TABLE replay_nonces ADD COLUMN payment_fingerprint TEXT;`);
    } catch {
      // already exists on upgraded stores
    }
    try {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_fingerprint_nonnull
        ON replay_nonces(payment_fingerprint)
        WHERE payment_fingerprint IS NOT NULL;
      `);
    } catch {
      // legacy or partially upgraded stores may fail once; continue with base indexes.
    }
  }

  spendState(payer) {
    const today = dayPrefix(nowIso());
    const row = this.stmt.spendByDay.get(payer, today);
    return {
      day: today,
      payer,
      units_spent_today: Number(row?.units ?? 0),
      recent_receipts: this.stmt.recentReceipts.all(payer, 10)
    };
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

  getIdempotencyRecord(key) {
    const row = this.stmt.getPaidIdempotency.get(key);
    if (!row) {
      return null;
    }
    return {
      ...row,
      response: fromJson(row.response_json, null)
    };
  }

  reserveIdempotencyKey({
    key,
    requestHash,
    payer,
    subjectId,
    nonce,
    mode
  }) {
    const now = nowIso();
    try {
      this.stmt.insertPaidIdempotency.run(
        key,
        requestHash,
        payer ?? null,
        subjectId ?? null,
        nonce ?? null,
        mode ?? null,
        now,
        now
      );
      return {
        ok: true,
        created: true,
        record: this.getIdempotencyRecord(key)
      };
    } catch (error) {
      if (!String(error?.message ?? "").includes("UNIQUE")) {
        throw error;
      }
      const existing = this.getIdempotencyRecord(key);
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

  finalizeIdempotencyKey({
    key,
    statusCode,
    response,
    errorCode,
    receiptId
  }) {
    this.stmt.updatePaidIdempotency.run(
      statusCode ?? null,
      toJson(response ?? null),
      errorCode ?? null,
      receiptId ?? null,
      nowIso(),
      key
    );
    return this.getIdempotencyRecord(key);
  }

  getCachedTrustForSubject(subjectId) {
    if (!subjectId) {
      return null;
    }
    const row = this.stmt.getTrustCache.get(subjectId);
    if (!row) {
      return null;
    }
    return {
      subject_id: row.subject_id,
      response: fromJson(row.response_json, null),
      updated_at: row.updated_at
    };
  }

  setCachedTrustForSubject(subjectId, response) {
    if (!subjectId || !response || typeof response !== "object") {
      return;
    }
    this.stmt.upsertTrustCache.run(subjectId, toJson(response), nowIso());
  }

  recordWarRoomEvent(event = {}) {
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
      receipt_id: event.receipt_id ?? null,
      amount: Number.isFinite(Number(event.amount)) ? Number(event.amount) : null,
      error_code: event.error_code ?? null,
      reason: event.reason ?? null
    };
    this.stmt.insertWarRoomEvent.run(
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
      normalized.receipt_id,
      normalized.amount,
      normalized.error_code,
      normalized.reason
    );
    return normalized;
  }

  listWarRoomEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return this.stmt.listWarRoomEvents.all(safeLimit);
  }

  assertNotReplay({ nonce, proofId, sessionId, payer, toolName, replayWindowSeconds, verifierReference }) {
    const now = nowIso();
    this.stmt.deleteExpiredReplay.run(now);
    const paymentFingerprint = this.buildPaymentFingerprint({
      nonce,
      proofId,
      sessionId,
      verifierReference,
      payer
    });
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
      this.stmt.insertReplayNonce.run(
        replayNonce,
        proofId ?? null,
        sessionId ?? null,
        payer ?? null,
        toolName ?? null,
        now,
        expiry,
        verifierReference ?? null,
        paymentFingerprint
      );
      return { ok: true, expires_at: expiry };
    } catch (error) {
      if (String(error?.message ?? "").includes("UNIQUE")) {
        const existingByNonce = nonce ? this.stmt.findReplayByNonce.get(nonce) : null;
        const existingByProof = proofId ? this.stmt.findReplayByProofId.get(proofId) : null;
        const existingByReference = verifierReference ? this.stmt.findReplayByVerifierRef.get(verifierReference) : null;
        const existingByFingerprint = paymentFingerprint ? this.stmt.findReplayByFingerprint.get(paymentFingerprint) : null;
        const existing = existingByNonce ?? existingByProof ?? existingByReference ?? existingByFingerprint ?? null;
        return {
          ok: false,
          reason: "PAYMENT_REPLAY_DETECTED",
          details: {
            nonce: nonce ?? null,
            proof_id: proofId ?? null,
            session_id: sessionId ?? null,
            verifier_reference: verifierReference ?? null,
            existing
          }
        };
      }
      throw error;
    }
  }

  reservePaidOperation({
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
    const receiptId = `xrc_${randomUUID()}`;
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const replay = this.assertNotReplay({
        nonce,
        proofId,
        sessionId,
        payer,
        toolName,
        replayWindowSeconds,
        verifierReference
      });
      if (!replay.ok) {
        this.db.exec("ROLLBACK");
        return replay;
      }

      const today = dayPrefix(now);
      const row = this.stmt.spendByDay.get(payer, today);
      const currentUnits = Number(row?.units ?? 0);
      const projected = currentUnits + billedUnits;
      if (projected > spendLimitUnits) {
        this.db.exec("ROLLBACK");
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

      this.stmt.insertReceipt.run(
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
        null,
        null,
        null,
        adapterTraceId ?? null,
        null,
        toJson(metadata)
      );

      this.db.exec("COMMIT");
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
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // transaction already closed
      }
      if (String(error?.message ?? "").includes("UNIQUE")) {
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
    }
  }

  createProvisionalReceipt({ verifierReference, proofId, sessionId, payer, toolName, billedUnits, adapterTraceId, metadata }) {
    const receiptId = `xrc_${randomUUID()}`;
    const now = nowIso();
    try {
      this.stmt.insertReceipt.run(
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
        null,
        null,
        null,
        adapterTraceId ?? null,
        null,
        toJson(metadata)
      );
    } catch (error) {
      if (String(error?.message ?? "").includes("UNIQUE")) {
        const existing = (verifierReference ? this.getReceiptByVerifierReference(verifierReference) : null) ?? (proofId ? this.getReceiptByProofId(proofId) : null);
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

  setReceiptInternalTrace(receiptId, internalTraceId) {
    this.stmt.setReceiptInternalTrace.run(internalTraceId ?? null, nowIso(), receiptId);
  }

  getReceiptById(receiptId) {
    if (!receiptId) {
      return null;
    }
    const row = this.stmt.getReceiptById.get(receiptId);
    if (!row) {
      return null;
    }
    return { ...row, metadata: fromJson(row.metadata_json, {}) };
  }

  getReceiptByVerifierReference(verifierReference) {
    if (!verifierReference) {
      return null;
    }
    const row = this.stmt.getReceiptByVerifierRef.get(verifierReference);
    if (!row) {
      return null;
    }
    return { ...row, metadata: fromJson(row.metadata_json, {}) };
  }

  getReceiptByProofId(proofId) {
    if (!proofId) {
      return null;
    }
    const row = this.stmt.getReceiptByProofId.get(proofId);
    if (!row) {
      return null;
    }
    return { ...row, metadata: fromJson(row.metadata_json, {}) };
  }

  updateReceiptSettlement({ receiptId, verifierReference, receiptStatus, settlementStatus, settledAt, reversedAt, lastError }) {
    const current = receiptId ? this.getReceiptById(receiptId) : this.getReceiptByVerifierReference(verifierReference);
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

    const updatedAt = nowIso();
    if (receiptId) {
      const result = this.stmt.updateReceiptStatusById.run(
        receiptStatus,
        settlementStatus,
        normalizedSettledAt,
        normalizedReversedAt,
        normalizedLastError,
        updatedAt,
        receiptId
      );
      return { updated: Number(result?.changes ?? 0) > 0 };
    }
    if (verifierReference) {
      const result = this.stmt.updateReceiptStatusByVerifierRef.run(
        receiptStatus,
        settlementStatus,
        normalizedSettledAt,
        normalizedReversedAt,
        normalizedLastError,
        updatedAt,
        verifierReference
      );
      return { updated: Number(result?.changes ?? 0) > 0 };
    }
    return { updated: false, reason: "MISSING_LOOKUP_KEY" };
  }

  recordToolUsage({ adapterTraceId, toolName, payer, callerSubjectId, targetSubjectId, billedUnits, receiptId, usageStatus }) {
    const usageId = `use_${randomUUID()}`;
    try {
      this.stmt.insertUsage.run(
        usageId,
        adapterTraceId ?? null,
        toolName,
        payer ?? null,
        callerSubjectId ?? null,
        targetSubjectId ?? null,
        billedUnits,
        receiptId ?? null,
        usageStatus,
        nowIso()
      );
    } catch (error) {
      if (!String(error?.message ?? "").includes("UNIQUE")) {
        throw error;
      }
      this.updateUsageStatus(adapterTraceId, usageStatus);
    }
  }

  updateUsageStatus(adapterTraceId, usageStatus) {
    if (!adapterTraceId) {
      return;
    }
    this.stmt.updateUsageStatusByTrace.run(usageStatus, nowIso(), adapterTraceId);
  }

  listUnsettledReceipts(limit = 100) {
    return this.stmt.listUnsettledReceipts.all(limit).map((row) => ({
      ...row,
      metadata: fromJson(row.metadata_json, {})
    }));
  }

  recordRequestLog({ adapterTraceId, toolName, statusCode, errorCode, latencyMs, billedUnits, receiptId, internalTraceId, details }) {
    this.stmt.insertRequestLog.run(
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
    );
  }

  recordBillingLedgerEntry({
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
    this.stmt.insertBillingLedger.run(
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
    );
  }

  upsertEntitlementSession(session) {
    this.stmt.upsertEntitlementSession.run(
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
    );
  }

  getEntitlementSessionById(sessionId) {
    const row = this.stmt.getEntitlementSession.get(sessionId);
    if (!row) {
      return null;
    }
    return {
      ...row,
      scopes: fromJson(row.scopes_json, [])
    };
  }

  getEntitlementSessionByJti(jti) {
    const row = this.stmt.getEntitlementByJti.get(jti);
    if (!row) {
      return null;
    }
    return {
      ...row,
      scopes: fromJson(row.scopes_json, [])
    };
  }

  acquireLock(lockName, ownerId, ttlSeconds = 30) {
    const now = new Date();
    const nowIsoValue = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    this.stmt.acquireLockInsert.run(lockName, ownerId, expiresAt, nowIsoValue);
    const lock = this.stmt.getLock.get(lockName);
    return lock?.owner_id === ownerId;
  }

  releaseLock(lockName, ownerId) {
    this.stmt.releaseLock.run(lockName, ownerId);
  }

  renewLock(lockName, ownerId, ttlSeconds = 30) {
    const now = new Date();
    const nowIsoValue = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const result = this.stmt.renewLock.run(expiresAt, nowIsoValue, lockName, ownerId, nowIsoValue);
    return Number(result?.changes ?? 0) > 0;
  }
}
