import { randomUUID } from "node:crypto";

function mapSettlement(payload = {}) {
  const status = String(payload.status ?? payload.settlement_status ?? "pending").toLowerCase();
  if (["settled", "confirmed", "paid"].includes(status)) {
    return { receipt_status: "settled", settlement_status: "settled", settled_at: new Date().toISOString(), reversed_at: null, last_error: null };
  }
  if (["failed", "reversed", "refunded", "chargeback"].includes(status)) {
    return { receipt_status: "reversed", settlement_status: "reversed", settled_at: null, reversed_at: new Date().toISOString(), last_error: payload.reason ?? status };
  }
  return { receipt_status: "verified", settlement_status: "provisional", settled_at: null, reversed_at: null, last_error: null };
}

const STATUS_RANK = {
  pending: 0,
  provisional: 1,
  settled: 2,
  reversed: 2
};

function isDowngrade(currentStatus, nextStatus) {
  const currentRank = STATUS_RANK[String(currentStatus ?? "pending")] ?? 0;
  const nextRank = STATUS_RANK[String(nextStatus ?? "pending")] ?? 0;
  return nextRank < currentRank;
}

export class ReconciliationService {
  constructor({ store, verifier, logger, lockTtlSeconds = 30 }) {
    this.store = store;
    this.verifier = verifier;
    this.logger = logger;
    this.lockName = "x402_reconciliation";
    this.workerId = `worker_${randomUUID()}`;
    this.lockTtlSeconds = Math.max(5, Number(lockTtlSeconds) || 30);
  }

  async applySettlementEvent(payload = {}) {
    const reference = payload.verifier_reference ?? payload.receipt_reference ?? null;
    const receiptId = payload.receipt_id ?? null;
    if (!reference && !receiptId) {
      return {
        ok: false,
        update_reason: "missing_receipt_reference",
        receipt_id: null,
        verifier_reference: null,
        settlement_status: null
      };
    }
    const mapped = mapSettlement(payload);
    const existing = receiptId
      ? await this.store.getReceiptById(receiptId)
      : await this.store.getReceiptByVerifierReference(reference);

    if (existing && isDowngrade(existing.settlement_status, mapped.settlement_status)) {
      this.logger?.warn?.({
        event: "receipt_settlement_downgrade_ignored",
        receipt_id: existing.receipt_id,
        verifier_reference: existing.verifier_reference,
        current_status: existing.settlement_status,
        attempted_status: mapped.settlement_status
      });
      return {
        ok: true,
        ignored: true,
        reason: "terminal_state_preserved",
        receipt_id: existing.receipt_id,
        verifier_reference: existing.verifier_reference,
        settlement_status: existing.settlement_status
      };
    }

    const update = await this.store.updateReceiptSettlement({
      receiptId,
      verifierReference: reference,
      receiptStatus: mapped.receipt_status,
      settlementStatus: mapped.settlement_status,
      settledAt: mapped.settled_at,
      reversedAt: mapped.reversed_at,
      lastError: mapped.last_error
    });

    this.logger?.info?.({
      event: "receipt_settlement_applied",
      receipt_id: receiptId,
      verifier_reference: reference,
      settlement_status: mapped.settlement_status,
      updated: update?.updated ?? false,
      update_reason: update?.reason ?? null
    });

    return {
      ok: Boolean(update?.updated),
      receipt_id: receiptId,
      verifier_reference: reference,
      settlement_status: mapped.settlement_status,
      update_reason: update?.reason ?? null
    };
  }

  async reconcileOnce({ limit = 100, adapterTraceId = null } = {}) {
    const lockAcquired = await this.store.acquireLock(this.lockName, this.workerId, this.lockTtlSeconds);
    if (!lockAcquired) {
      return { ok: true, skipped: true, reason: "lock_held" };
    }

    try {
      const unsettled = await this.store.listUnsettledReceipts(limit);
      let updated = 0;
      let lostLock = false;
      for (const receipt of unsettled) {
        const lockRenewed = await this.store.renewLock(this.lockName, this.workerId, this.lockTtlSeconds);
        if (!lockRenewed) {
          lostLock = true;
          this.logger?.warn?.({
            event: "receipt_reconciliation_lock_lost",
            worker_id: this.workerId
          });
          break;
        }
        if (!receipt.verifier_reference) {
          continue;
        }
        const status = await this.verifier.getReceiptStatus(receipt.verifier_reference, adapterTraceId);
        if (!status) {
          continue;
        }
        const mapped = mapSettlement(status);
        const update = await this.store.updateReceiptSettlement({
          receiptId: receipt.receipt_id,
          verifierReference: receipt.verifier_reference,
          receiptStatus: mapped.receipt_status,
          settlementStatus: mapped.settlement_status,
          settledAt: mapped.settled_at,
          reversedAt: mapped.reversed_at,
          lastError: mapped.last_error
        });
        if (update?.updated) {
          updated += 1;
        }
      }

      this.logger?.info?.({
        event: "receipt_reconciliation_run",
        checked: unsettled.length,
        updated,
        lost_lock: lostLock
      });

      return { ok: true, checked: unsettled.length, updated, lost_lock: lostLock };
    } finally {
      await this.store.releaseLock(this.lockName, this.workerId);
    }
  }
}
