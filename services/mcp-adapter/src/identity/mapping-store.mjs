import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getSharedPostgresPool } from "../storage/postgres-driver.mjs";

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function emptyState() {
  return { version: "1", mappings: {} };
}

function readState(filePath) {
  try {
    const parsed = safeParse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.mappings !== "object" || parsed.mappings === null) {
      return emptyState();
    }
    return {
      version: String(parsed.version ?? "1"),
      mappings: parsed.mappings
    };
  } catch {
    return emptyState();
  }
}

function writeStateAtomic(filePath, nextState) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(nextState, null, 2), { mode: 0o600 });
  renameSync(tempPath, filePath);
}

export class FileIdentityMappingStore {
  constructor({ filePath }) {
    this.filePath = filePath;
  }

  async getByExternalId(externalId) {
    const state = readState(this.filePath);
    return state.mappings?.[externalId] ?? null;
  }

  async upsert(externalId, value) {
    const state = readState(this.filePath);
    const previous = state.mappings?.[externalId] ?? null;
    const next = {
      ...(previous ?? {}),
      ...value,
      updated_at: new Date().toISOString()
    };
    state.mappings[externalId] = next;
    writeStateAtomic(this.filePath, state);
    return next;
  }
}

export class PostgresIdentityMappingStore {
  constructor({ pool }) {
    this.pool = pool;
    this.externalSource = "agentic.market";
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS external_identity_mappings (
        id BIGSERIAL PRIMARY KEY,
        external_source TEXT NOT NULL,
        external_subject_id TEXT NOT NULL,
        internal_subject_id TEXT NOT NULL,
        external_handle TEXT,
        did TEXT,
        wallet TEXT,
        environment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(external_source, external_subject_id)
      );
      CREATE INDEX IF NOT EXISTS idx_external_identity_internal_subject_id
        ON external_identity_mappings(internal_subject_id);
    `);
  }

  async getByExternalId(externalId) {
    const result = await this.pool.query(
      `
        SELECT external_source, external_subject_id, internal_subject_id, external_handle, did, wallet, environment, created_at, updated_at
        FROM external_identity_mappings
        WHERE external_source = $1 AND external_subject_id = $2
        LIMIT 1
      `,
      [this.externalSource, externalId]
    );
    return result.rows[0] ?? null;
  }

  async upsert(externalId, value) {
    const result = await this.pool.query(
      `
        INSERT INTO external_identity_mappings (
          external_source, external_subject_id, internal_subject_id, external_handle, did, wallet, environment, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
        ON CONFLICT(external_source, external_subject_id) DO UPDATE SET
          internal_subject_id = EXCLUDED.internal_subject_id,
          external_handle = EXCLUDED.external_handle,
          did = EXCLUDED.did,
          wallet = EXCLUDED.wallet,
          environment = EXCLUDED.environment,
          updated_at = EXCLUDED.updated_at
        RETURNING external_source, external_subject_id, internal_subject_id, external_handle, did, wallet, environment, created_at, updated_at
      `,
      [
        this.externalSource,
        externalId,
        value.internal_subject_id,
        value.external_handle ?? null,
        value.did ?? null,
        value.wallet ?? null,
        value.environment ?? null,
        value.created_at ?? new Date().toISOString()
      ]
    );
    return result.rows[0] ?? null;
  }
}

export async function createIdentityMappingStore(config) {
  if (config.identityMapDriver === "file") {
    return new FileIdentityMappingStore({ filePath: config.identityMapPath });
  }
  if (config.identityMapDriver === "postgres") {
    const pool = await getSharedPostgresPool(config.identityMapDatabaseUrl ?? config.stateStoreDatabaseUrl);
    const store = new PostgresIdentityMappingStore({ pool });
    await store.init();
    return store;
  }
  throw new Error(`Unsupported identity mapping store driver: ${config.identityMapDriver}`);
}
