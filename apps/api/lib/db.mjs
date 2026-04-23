import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_POLICY } from "../../../packages/schema/index.mjs";

const DATA_DIR = process.env.DATA_DIR || path.resolve("./data");

function runStatements(db, sql) {
  for (const statement of sql
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    db.exec(`${statement};`);
  }
}

function safeExec(db, sql) {
  try {
    db.exec(sql);
  } catch {
    // Best-effort compatibility migration for existing local SQLite files.
  }
}

export function initDb(dbPath) {
  const resolvedDbPath = dbPath ? path.resolve(dbPath) : path.join(DATA_DIR, "infopunks.production.db");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  const db = new DatabaseSync(resolvedDbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  runStatements(
    db,
    `
    CREATE TABLE IF NOT EXISTS passports (
      passport_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL UNIQUE,
      subject_type TEXT NOT NULL,
      did TEXT UNIQUE,
      status TEXT NOT NULL,
      issuer_id TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS passport_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passport_id TEXT NOT NULL,
      kid TEXT NOT NULL,
      alg TEXT NOT NULL,
      public_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(passport_id, kid),
      FOREIGN KEY(passport_id) REFERENCES passports(passport_id)
    );
    CREATE TABLE IF NOT EXISTS passport_capabilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passport_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      verified INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(passport_id) REFERENCES passports(passport_id)
    );
    CREATE TABLE IF NOT EXISTS evidence_records (
      evidence_id TEXT PRIMARY KEY,
      evidence_hash TEXT,
      subject_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      task_id TEXT,
      context TEXT NOT NULL,
      outcome TEXT NOT NULL,
      disputes TEXT NOT NULL,
      provenance TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_subject_created ON evidence_records(subject_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evidence_task_id ON evidence_records(task_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_hash_unique ON evidence_records(evidence_hash);
    CREATE TABLE IF NOT EXISTS evidence_validators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id TEXT NOT NULL,
      validator_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      weight REAL NOT NULL,
      reason_codes TEXT NOT NULL,
      FOREIGN KEY(evidence_id) REFERENCES evidence_records(evidence_id)
    );
    CREATE TABLE IF NOT EXISTS trust_snapshots (
      subject_id TEXT PRIMARY KEY,
      snapshot_version INTEGER NOT NULL,
      vector TEXT NOT NULL,
      aggregate_counts TEXT NOT NULL,
      last_event_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trust_resolutions (
      resolution_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      score INTEGER NOT NULL,
      band TEXT NOT NULL,
      confidence REAL NOT NULL,
      decision TEXT NOT NULL,
      reason_codes TEXT NOT NULL,
      recommended_validators TEXT NOT NULL,
      policy_actions TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      trace_id TEXT NOT NULL UNIQUE,
      engine_version TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trust_resolutions_subject_created ON trust_resolutions(subject_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS routing_decisions (
      routing_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      route_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      selected TEXT NOT NULL,
      rejected TEXT NOT NULL,
      policy_actions TEXT NOT NULL,
      rerouted INTEGER NOT NULL DEFAULT 0,
      reroute_reason TEXT,
      quorum TEXT NOT NULL DEFAULT 'null',
      trace_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS traces (
      trace_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      resolution_id TEXT,
      routing_id TEXT,
      input_refs TEXT NOT NULL,
      context TEXT NOT NULL,
      scoring TEXT NOT NULL,
      outputs TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dispute_evaluations (
      dispute_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      task_id TEXT,
      reason_code TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_ids TEXT NOT NULL,
      evaluation TEXT NOT NULL,
      actions TEXT NOT NULL,
      trace_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhooks (
      webhook_id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      status TEXT NOT NULL,
      event_types TEXT NOT NULL,
      subjects TEXT NOT NULL,
      max_attempts INTEGER NOT NULL,
      signing_alg TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      delivery_id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      response_status INTEGER,
      last_error TEXT,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(webhook_id) REFERENCES webhooks(webhook_id)
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event_id, webhook_id);
    CREATE TABLE IF NOT EXISTS portability_receipts (
      receipt_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      source_environment TEXT NOT NULL,
      target_network TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      signature TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policy_versions (
      policy_id TEXT NOT NULL,
      version TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(policy_id, version)
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trust_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      trace_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    `
  );
  safeExec(db, "ALTER TABLE evidence_records ADD COLUMN evidence_hash TEXT;");
  safeExec(db, "ALTER TABLE routing_decisions ADD COLUMN rerouted INTEGER NOT NULL DEFAULT 0;");
  safeExec(db, "ALTER TABLE routing_decisions ADD COLUMN reroute_reason TEXT;");
  safeExec(db, "ALTER TABLE routing_decisions ADD COLUMN quorum TEXT NOT NULL DEFAULT 'null';");

  const existingPolicy = db
    .prepare("SELECT policy_id FROM policy_versions WHERE policy_id = ? AND version = ?")
    .get(DEFAULT_POLICY.policy_id, DEFAULT_POLICY.version);
  if (!existingPolicy) {
    db.prepare(
      "INSERT INTO policy_versions (policy_id, version, body, created_at) VALUES (?, ?, ?, ?)"
    ).run(DEFAULT_POLICY.policy_id, DEFAULT_POLICY.version, JSON.stringify(DEFAULT_POLICY), new Date().toISOString());
  }
  return db;
}
