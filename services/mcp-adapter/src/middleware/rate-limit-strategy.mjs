import { createHash } from "node:crypto";
import { getSharedPostgresPool } from "../storage/postgres-driver.mjs";

function normalizeKey(key) {
  return createHash("sha256").update(String(key ?? "anonymous")).digest("hex");
}

export class MemoryRateLimitStrategy {
  constructor({ maxTrackedKeys = 10000 } = {}) {
    this.maxTrackedKeys = maxTrackedKeys;
    this.calls = new Map();
    this.lastMinute = null;
  }

  prune(minute) {
    if (this.lastMinute === minute && this.calls.size <= this.maxTrackedKeys) {
      return;
    }
    this.lastMinute = minute;

    for (const [bucketKey, value] of this.calls.entries()) {
      if (value.minute < minute) {
        this.calls.delete(bucketKey);
      }
    }

    if (this.calls.size <= this.maxTrackedKeys) {
      return;
    }

    for (const bucketKey of this.calls.keys()) {
      this.calls.delete(bucketKey);
      if (this.calls.size <= this.maxTrackedKeys) {
        break;
      }
    }
  }

  async hit(key, minute = Math.floor(Date.now() / 60000)) {
    this.prune(minute);
    const normalized = normalizeKey(key);
    const bucketKey = `${normalized}:${minute}`;
    const existing = this.calls.get(bucketKey);
    const count = (existing?.count ?? 0) + 1;
    this.calls.set(bucketKey, { minute, count });
    return count;
  }
}

export class PostgresRateLimitStrategy {
  constructor({ pool }) {
    this.pool = pool;
    this.cleanupModulo = 0;
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS adapter_rate_limit_counters (
        key_hash TEXT NOT NULL,
        bucket_minute BIGINT NOT NULL,
        count INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY(key_hash, bucket_minute)
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limit_updated_at ON adapter_rate_limit_counters(updated_at);
    `);
  }

  async hit(key, minute = Math.floor(Date.now() / 60000)) {
    const normalized = normalizeKey(key);
    const result = await this.pool.query(
      `
        INSERT INTO adapter_rate_limit_counters (key_hash, bucket_minute, count, updated_at)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT(key_hash, bucket_minute) DO UPDATE
        SET count = adapter_rate_limit_counters.count + 1, updated_at = NOW()
        RETURNING count
      `,
      [normalized, minute]
    );

    // Opportunistic cleanup of stale windows without dedicated cron.
    this.cleanupModulo = (this.cleanupModulo + 1) % 50;
    if (this.cleanupModulo === 0) {
      await this.pool.query(`DELETE FROM adapter_rate_limit_counters WHERE bucket_minute < $1`, [minute - 5]);
    }

    return Number(result.rows[0]?.count ?? 0);
  }
}

export async function createRateLimitStrategy(config) {
  if (config.rateLimitDriver === "memory") {
    return new MemoryRateLimitStrategy();
  }
  if (config.rateLimitDriver === "postgres") {
    const pool = await getSharedPostgresPool(config.rateLimitPostgresUrl ?? config.stateStoreDatabaseUrl);
    const strategy = new PostgresRateLimitStrategy({ pool });
    await strategy.init();
    return strategy;
  }
  throw new Error(`Unsupported rate-limit strategy driver: ${config.rateLimitDriver}`);
}
