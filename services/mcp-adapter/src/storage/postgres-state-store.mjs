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
    `);
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
