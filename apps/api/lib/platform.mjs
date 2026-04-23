import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_POLICY, EVIDENCE_EVENT_TYPES, SUBJECT_TYPES } from "../../../packages/schema/index.mjs";
import { makeCloudEvent } from "../../../packages/event-contracts/index.mjs";
import { getPrompt } from "../../../packages/prompt-pack/index.mjs";
import {
  computeResolution,
  computeSnapshot,
  computeTrustEvent,
  stableHash,
  validationEligible
} from "../../../packages/trust-engine/index.mjs";
import { shapeTraceReplayBundle, shapeTrustExplanation, shapeWarRoomState } from "./contracts.mjs";
import { initDb } from "./db.mjs";
import { appError, forbiddenError, normalizeError, notFoundError, unauthorizedError } from "./errors.mjs";
import { clamp, hashPayload, makeId, nowIso, round } from "./utils.mjs";

function parseJsonColumn(value, fallback) {
  if (!value) {
    return fallback;
  }
  return JSON.parse(value);
}

function parseJsonEnv(rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallback;
  }
}

function normalizeScopes(scopes) {
  const normalized = Array.isArray(scopes) ? scopes.filter(Boolean) : [];
  return normalized.length > 0 ? [...new Set(normalized)] : ["read", "write"];
}

function parseApiKeyRegistry({ defaultApiKey, apiKeysConfig, environment }) {
  const configured = parseJsonEnv(apiKeysConfig, null);
  const entries = Array.isArray(configured) ? configured : configured?.keys;
  const registry = new Map();

  if (!entries?.length) {
    registry.set(defaultApiKey, {
      token: defaultApiKey,
      key_id: `key_${environment}_root`,
      caller_id: "local-root",
      scopes: ["read", "write"],
      environment,
      status: "active"
    });
    return registry;
  }

  for (const entry of entries) {
    if (!entry?.token) {
      continue;
    }
    registry.set(entry.token, {
      token: entry.token,
      key_id: entry.key_id ?? `key_${makeId("api")}`,
      caller_id: entry.caller_id ?? entry.key_id ?? "anonymous-client",
      scopes: normalizeScopes(entry.scopes),
      environment: entry.environment ?? environment,
      status: entry.status ?? "active"
    });
  }

  return registry;
}

function defaultRateLimitConfig() {
  return {
    default: { cost: 1, limit: 1200 },
    read: { cost: 1, limit: 1200 },
    write: { cost: 4, limit: 600 },
    sim: { cost: 12, limit: 120 },
    stream: { cost: 8, limit: 120 }
  };
}

function toPassport(row, db) {
  if (!row) {
    return null;
  }
  const metadata = parseJsonColumn(row.metadata, {});
  const keys = db
    .prepare("SELECT kid, alg, public_key FROM passport_keys WHERE passport_id = ? ORDER BY id ASC")
    .all(row.passport_id)
    .map((entry) => ({
      kid: entry.kid,
      alg: entry.alg,
      public_key: entry.public_key
    }));
  const capabilities = db
    .prepare("SELECT name, version, verified FROM passport_capabilities WHERE passport_id = ? ORDER BY id ASC")
    .all(row.passport_id)
    .map((entry) => ({
      name: entry.name,
      version: entry.version,
      verified: Boolean(entry.verified)
    }));
  return {
    passport_id: row.passport_id,
    subject_id: row.subject_id,
    subject_type: row.subject_type,
    did: row.did,
    status: row.status,
    issuer: {
      issuer_id: row.issuer_id,
      signature: metadata.issuer_signature ?? "ed25519:self-issued-v1",
      provenance: metadata.issuer_provenance ?? {
        trust_anchor: "infopunks-local-root",
        verification_method: "self_attested_signature",
        issued_at: row.created_at
      }
    },
    public_keys: keys,
    capabilities,
    reputation_scope_defaults:
      metadata.reputation_scope_defaults ?? {
        domains: [],
        risk_tolerance: "medium"
      },
    lifecycle: {
      status: row.status,
      status_reason: metadata.lifecycle?.status_reason ?? null,
      last_status_change_at: metadata.lifecycle?.last_status_change_at ?? row.updated_at,
      last_key_rotation_at: metadata.lifecycle?.last_key_rotation_at ?? null,
      key_count: keys.length
    },
    portability: metadata.portability ?? {
      portable_format: "passport_bundle@v1",
      exportable: true,
      scope_defaults_included: true,
      issuer_attested: Boolean(metadata.issuer_signature)
    },
    metadata: Object.fromEntries(
      Object.entries(metadata).filter(([key]) =>
        !["issuer_signature", "issuer_provenance", "reputation_scope_defaults", "lifecycle", "portability"].includes(key)
      )
    ),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toEvidence(row, db) {
  const validators = db
    .prepare("SELECT validator_id, verdict, weight, reason_codes FROM evidence_validators WHERE evidence_id = ? ORDER BY id ASC")
    .all(row.evidence_id)
    .map((entry) => ({
      validator_id: entry.validator_id,
      verdict: entry.verdict,
      weight: Number(entry.weight),
      reason_codes: parseJsonColumn(entry.reason_codes, [])
    }));
  return {
    evidence_id: row.evidence_id,
    subject_id: row.subject_id,
    event_type: row.event_type,
    task_id: row.task_id,
    context: parseJsonColumn(row.context, {}),
    outcome: parseJsonColumn(row.outcome, {}),
    validators,
    disputes: parseJsonColumn(row.disputes, []),
    provenance: parseJsonColumn(row.provenance, {}),
    created_at: row.created_at
  };
}

function toSnapshot(row) {
  if (!row) {
    return null;
  }
  return {
    subject_id: row.subject_id,
    snapshot_version: Number(row.snapshot_version),
    vector: parseJsonColumn(row.vector, {}),
    aggregate_counts: parseJsonColumn(row.aggregate_counts, {}),
    last_event_at: row.last_event_at,
    updated_at: row.updated_at
  };
}

function toResolution(row) {
  if (!row) {
    return null;
  }
  return {
    resolution_id: row.resolution_id,
    subject_id: row.subject_id,
    context_hash: row.context_hash,
    score: Number(row.score),
    band: row.band,
    confidence: Number(row.confidence),
    decision: row.decision,
    reason_codes: parseJsonColumn(row.reason_codes, []),
    recommended_validators: parseJsonColumn(row.recommended_validators, []),
    policy_actions: parseJsonColumn(row.policy_actions, []),
    score_breakdown: parseJsonColumn(row.score_breakdown, {}),
    trace_id: row.trace_id,
    engine_version: row.engine_version,
    policy_version: row.policy_version,
    expires_at: row.expires_at,
    created_at: row.created_at
  };
}

function toRouting(row) {
  if (!row) {
    return null;
  }
  return {
    routing_id: row.routing_id,
    task_id: row.task_id,
    route_type: row.route_type,
    subject_id: row.subject_id,
    selected: parseJsonColumn(row.selected, []),
    rejected: parseJsonColumn(row.rejected, []),
    policy_actions: parseJsonColumn(row.policy_actions, []),
    rerouted: Boolean(row.rerouted),
    reroute_reason: row.reroute_reason ?? null,
    quorum: parseJsonColumn(row.quorum, null),
    trace_id: row.trace_id,
    created_at: row.created_at
  };
}

function toDisputeEvaluation(row) {
  if (!row) {
    return null;
  }
  return {
    dispute_id: row.dispute_id,
    subject_id: row.subject_id,
    task_id: row.task_id,
    status: row.status,
    severity: row.severity,
    reason_code: row.reason_code,
    evidence_ids: parseJsonColumn(row.evidence_ids, []),
    evaluation: parseJsonColumn(row.evaluation, {}),
    actions: parseJsonColumn(row.actions, []),
    trace_id: row.trace_id,
    created_at: row.created_at
  };
}

function toWebhook(row) {
  if (!row) {
    return null;
  }
  return {
    webhook_id: row.webhook_id,
    url: row.url,
    status: row.status,
    event_types: parseJsonColumn(row.event_types, []),
    subjects: parseJsonColumn(row.subjects, []),
    max_attempts: Number(row.max_attempts),
    signing_alg: row.signing_alg,
    secret_present: Boolean(row.secret),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const DISPUTE_RESOLUTION_ORDER = [
  "uphold_current_trust",
  "request_additional_validation",
  "reverse_validation_credit",
  "quarantine_subject"
];

function stricterResolution(left, right) {
  if (!right) {
    return left;
  }
  if (!left) {
    return right;
  }
  return DISPUTE_RESOLUTION_ORDER.indexOf(right) > DISPUTE_RESOLUTION_ORDER.indexOf(left) ? right : left;
}

function normalizeQuorumPolicy(input = {}, fallbackMinimumCount = 1, policy = DEFAULT_POLICY) {
  const mode = input?.mode ?? "minimum";
  const requiredCount =
    Number(input?.required_count ?? fallbackMinimumCount ?? 1) ||
    1;
  const consensusThreshold =
    Number(input?.consensus_threshold ?? policy.thresholds.default_quorum_consensus_threshold ?? 0.67) || 0.67;
  const escalationAction = input?.escalation_action ?? "additional_validators";
  return {
    mode,
    required_count: Math.max(1, requiredCount),
    consensus_threshold: clamp(0, consensusThreshold, 1),
    escalation_action: escalationAction
  };
}

function computeEvidenceFingerprint(input) {
  return hashPayload({
    subject_id: input.subject_id,
    event_type: input.event_type,
    task_id: input.task_id ?? null,
    context: input.context ?? {},
    outcome: input.outcome ?? {},
    validators: (input.validators ?? []).map((validator) => ({
      validator_id: validator.validator_id,
      verdict: validator.verdict,
      weight: Number(validator.weight ?? 0),
      reason_codes: validator.reason_codes ?? []
    })),
    disputes: input.disputes ?? [],
    provenance: {
      source_system: input.provenance?.source_system ?? null,
      trace_id: input.provenance?.trace_id ?? null,
      span_id: input.provenance?.span_id ?? null
    }
  });
}

export class TrustPlatform {
  constructor({
    dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/infopunks.db"),
    apiKey = process.env.INFOPUNKS_API_KEY || "dev-infopunks-key",
    environment = process.env.INFOPUNKS_ENVIRONMENT || "local",
    apiKeysConfig = process.env.INFOPUNKS_API_KEYS_JSON || null,
    rateLimitConfig = parseJsonEnv(process.env.INFOPUNKS_RATE_LIMITS_JSON, defaultRateLimitConfig()),
    sseMaxStreamsPerKey = Number(process.env.INFOPUNKS_SSE_MAX_STREAMS_PER_KEY || 2),
    webhookRetryBaseMs = Number(process.env.INFOPUNKS_WEBHOOK_RETRY_BASE_MS || 250),
    portabilitySigningKey = process.env.INFOPUNKS_PORTABILITY_SIGNING_KEY || "dev-portability-signing-key"
  } = {}) {
    this.db = initDb(dbPath);
    this.apiKey = apiKey;
    this.environment = environment;
    this.apiKeys = parseApiKeyRegistry({
      defaultApiKey: apiKey,
      apiKeysConfig,
      environment
    });
    this.rateLimitConfig = {
      ...defaultRateLimitConfig(),
      ...(rateLimitConfig ?? {})
    };
    this.sseMaxStreamsPerKey = sseMaxStreamsPerKey;
    this.webhookRetryBaseMs = webhookRetryBaseMs;
    this.portabilitySigningKey = portabilitySigningKey;
    this.metrics = {
      http_requests_total: 0,
      http_request_duration_ms: [],
      http_status_counts: new Map(),
      http_error_code_counts: new Map(),
      http_route_timings: new Map(),
      evidence_ingest_total: 0,
      snapshot_update_duration_ms: [],
      trust_resolve_total: 0,
      trust_resolve_duration_ms: [],
      routing_decision_total: 0,
      event_emit_total: 0,
      event_lag_ms: [],
      event_type_counts: new Map(),
      low_confidence_total: 0,
      collusion_alert_total: 0
    };
    this.rateLimits = new Map();
    this.activeStreamsByKey = new Map();
    this.lastRateLimitCleanupMinute = null;
    this.streams = new Set();
    this.webhookTimers = new Set();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  authenticate(token, auth = { requiredScope: "read" }) {
    if (!token) {
      throw unauthorizedError();
    }
    const record = this.apiKeys.get(token);
    if (!record || record.status !== "active") {
      throw unauthorizedError();
    }
    if (record.environment !== this.environment) {
      throw forbiddenError("API key environment does not match the current control plane environment.", {
        key_id: record.key_id,
        key_environment: record.environment,
        expected_environment: this.environment
      }, ["use_matching_environment_key"]);
    }
    const requiredScope = auth?.requiredScope ?? "read";
    if (requiredScope && !record.scopes.includes(requiredScope)) {
      throw forbiddenError("API key lacks the required scope.", {
        key_id: record.key_id,
        required_scope: requiredScope,
        granted_scopes: record.scopes
      }, ["use_key_with_required_scope"]);
    }
    return {
      token,
      key_id: record.key_id,
      caller_id: record.caller_id,
      scopes: record.scopes,
      environment: record.environment
    };
  }

  cleanupRateLimits(currentMinute) {
    if (this.lastRateLimitCleanupMinute === currentMinute) {
      return;
    }
    for (const key of this.rateLimits.keys()) {
      const windowMinute = Number(key.split(":").at(-1));
      if (windowMinute < currentMinute - 2) {
        this.rateLimits.delete(key);
      }
    }
    this.lastRateLimitCleanupMinute = currentMinute;
  }

  resolveRateLimit(routeRateLimit = {}) {
    const bucket = routeRateLimit.bucket ?? "default";
    const config = this.rateLimitConfig[bucket] ?? this.rateLimitConfig.default;
    return {
      bucket,
      cost: routeRateLimit.cost ?? config.cost ?? 1,
      limit: routeRateLimit.limit ?? config.limit ?? 600
    };
  }

  enforceRateLimit(authContext, routeRateLimit = {}) {
    const minute = Math.floor(Date.now() / 60000);
    this.cleanupRateLimits(minute);
    const policy = this.resolveRateLimit(routeRateLimit);
    const key = `${authContext.key_id}:${policy.bucket}:${minute}`;
    const used = this.rateLimits.get(key) ?? 0;
    if (used + policy.cost > policy.limit) {
      return false;
    }
    this.rateLimits.set(key, used + policy.cost);
    return true;
  }

  openEventStream(authContext) {
    const active = this.activeStreamsByKey.get(authContext.key_id) ?? 0;
    if (active >= this.sseMaxStreamsPerKey) {
      throw appError({
        code: "RATE_LIMITED",
        message: "Too many concurrent event streams for API key.",
        statusCode: 429,
        details: {
          key_id: authContext.key_id,
          active_streams: active,
          max_streams: this.sseMaxStreamsPerKey
        },
        suggestedActions: ["close_existing_stream", "retry_later"]
      });
    }
    this.activeStreamsByKey.set(authContext.key_id, active + 1);
    return () => {
      const current = this.activeStreamsByKey.get(authContext.key_id) ?? 0;
      if (current <= 1) {
        this.activeStreamsByKey.delete(authContext.key_id);
        return;
      }
      this.activeStreamsByKey.set(authContext.key_id, current - 1);
    };
  }

  recordMetric(name, value) {
    if (Array.isArray(this.metrics[name])) {
      this.metrics[name].push(value);
    } else {
      this.metrics[name] += value;
    }
  }

  recordHttpObservation({ routeId, statusCode, errorCode, durationMs }) {
    this.recordMetric("http_requests_total", 1);
    this.recordMetric("http_request_duration_ms", durationMs);
    const statusKey = String(statusCode);
    this.metrics.http_status_counts.set(statusKey, (this.metrics.http_status_counts.get(statusKey) ?? 0) + 1);
    if (errorCode) {
      this.metrics.http_error_code_counts.set(errorCode, (this.metrics.http_error_code_counts.get(errorCode) ?? 0) + 1);
    }
    const routeMetric = this.metrics.http_route_timings.get(routeId) ?? { totalMs: 0, count: 0 };
    routeMetric.totalMs += durationMs;
    routeMetric.count += 1;
    this.metrics.http_route_timings.set(routeId, routeMetric);
  }

  getPolicy(policyId = DEFAULT_POLICY.policy_id, version = DEFAULT_POLICY.version) {
    const row = this.db
      .prepare("SELECT body FROM policy_versions WHERE policy_id = ? AND version = ?")
      .get(policyId, version);
    return row ? JSON.parse(row.body) : DEFAULT_POLICY;
  }

  estimateOperation(operation, input = {}) {
    const mode = input.response_mode ?? "standard";
    const modeMultiplier = {
      minimal: 0.6,
      standard: 1,
      explain: 1.35,
      audit: 1.8
    }[mode] ?? 1;
    const evidenceWindow = Number(input.evidence_window ?? input.evidence_limit ?? 20);
    const candidateCount = Array.isArray(input.candidates) ? input.candidates.length : 0;
    const riskMultiplier =
      input.context?.risk_level === "high" ? 1.25 : input.context?.risk_level === "low" ? 0.9 : 1;
    const baseUnits = {
      "trust.resolve": 8,
      "routing.select_validator": 7,
      "routing.select_executor": 8,
      "traces.get": 11,
      "trust.explain": 10,
      "disputes.evaluate": 9
    }[operation] ?? 4;
    const units = round(
      baseUnits * modeMultiplier * riskMultiplier + Math.min(6, evidenceWindow / 20) + Math.min(4, candidateCount / 5),
      2
    );
    const estimatedTokens = Math.max(60, Math.round(units * 75));
    const estimatedCostUsd = round(units * 0.00018 + estimatedTokens * 0.0000015, 6);
    return {
      units,
      estimated_tokens: estimatedTokens,
      estimated_cost_usd: estimatedCostUsd
    };
  }

  determineResponsePreset(routeId, body) {
    if (routeId === "trust.resolve") {
      if (body?.trace) {
        return "audit";
      }
      if (body?.explanation) {
        return "explain";
      }
      if (body?.resolution_id) {
        return "standard";
      }
      return "minimal";
    }
    if (["traces.get", "war-room.state", "economic.attestation-bundle"].includes(routeId)) {
      return "audit";
    }
    if (["trust.explain", "prompts.get"].includes(routeId)) {
      return "explain";
    }
    return "standard";
  }

  getBudgetRemaining(authContext, routeRateLimit = {}) {
    if (!authContext) {
      return null;
    }
    const minute = Math.floor(Date.now() / 60000);
    const policy = this.resolveRateLimit(routeRateLimit);
    const key = `${authContext.key_id}:${policy.bucket}:${minute}`;
    const used = this.rateLimits.get(key) ?? 0;
    return {
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - used),
      bucket: policy.bucket
    };
  }

  buildBudgetHints({ routeId, authContext, routeRateLimit = {}, preset, body }) {
    const budget = this.getBudgetRemaining(authContext, routeRateLimit);
    const recommendedCacheTtl =
      routeId === "war-room.state" ? 5 : routeId === "traces.get" ? 300 : routeId === "passports.get" ? 300 : 60;
    const recommendedResponseMode =
      routeId === "budget.quote"
        ? body?.recommended_response_mode ?? "minimal"
        : routeId === "traces.get" || routeId === "war-room.state"
          ? "audit"
          : routeId === "prompts.get"
            ? "explain"
            : preset;
    const remaining = budget?.remaining ?? 9999;
    const limit = budget?.limit ?? 10000;
    const budgetStatus = remaining <= limit * 0.15 ? "constrained" : remaining <= limit * 0.4 ? "watch" : "healthy";
    return {
      recommended_response_mode: recommendedResponseMode,
      recommended_cache_ttl_s: recommendedCacheTtl,
      budget_remaining_units: round(remaining, 2),
      budget_status: budgetStatus
    };
  }

  decorateResponse({ routeId, body, authContext, routeRateLimit = {}, statusCode }) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return body;
    }
    if (routeId === "healthz") {
      return body;
    }
    const preset = this.determineResponsePreset(routeId, body);
    const encoded = Buffer.byteLength(JSON.stringify(body), "utf8");
    const tokens = Math.max(12, Math.round(encoded / 4));
    const routeUnits = {
      "passports.create": 2.2,
      "passports.get": 1.3,
      "passports.rotate-key": 2.5,
      "evidence.create": 3.8,
      "disputes.evaluate": 8.6,
      "trust.resolve": 8.2,
      "routing.select-validator": 7.4,
      "routing.select-executor": 8.4,
      "webhooks.create": 2.8,
      "budget.quote": 1.6,
      "portability.export": 9.4,
      "portability.import": 9.8,
      "economic.escrow-quote": 4.5,
      "economic.risk-price": 4.7,
      "economic.attestation-bundle": 8.1,
      "traces.get": 10.5,
      "trust.explain": 7.5,
      "prompts.get": 1.8,
      "war-room.state": 8.8,
      "sim.run": 18
    }[routeId] ?? 1.5;
    const presetMultiplier = { minimal: 0.65, standard: 1, explain: 1.3, audit: 1.7 }[preset] ?? 1;
    const computeUnits = round(routeUnits * presetMultiplier + encoded / 6000 + (statusCode >= 400 ? 0.3 : 0), 2);
    const responseCost = {
      compute_units: computeUnits,
      estimated_tokens: tokens,
      estimated_cost_usd: round(computeUnits * 0.00018 + tokens * 0.0000015, 6),
      response_bytes: encoded,
      preset
    };
    const budgetHints = this.buildBudgetHints({
      routeId,
      authContext,
      routeRateLimit,
      preset,
      body
    });
    return {
      ...body,
      response_cost: responseCost,
      budget_hints: budgetHints
    };
  }

  quoteBudget(input, authContext) {
    const operation = input.operation;
    const estimate = this.estimateOperation(operation, input);
    const budgetCap = Number(input.budget_cap_units ?? Infinity);
    const recommendedResponseMode =
      budgetCap < estimate.units ? "minimal" : input.response_mode ?? (operation === "traces.get" ? "audit" : "standard");
    const remaining = this.getBudgetRemaining(authContext, { bucket: "read" })?.remaining ?? 9999;
    const budgetStatus = estimate.units > budgetCap || estimate.units > remaining ? "constrained" : estimate.units > remaining * 0.5 ? "watch" : "healthy";
    return {
      operation,
      estimated_compute_units: estimate.units,
      estimated_tokens: estimate.estimated_tokens,
      estimated_cost_usd: estimate.estimated_cost_usd,
      recommended_response_mode: recommendedResponseMode,
      budget_status: budgetStatus,
      explanation: [
        `Estimated from operation=${operation} and response_mode=${recommendedResponseMode}.`,
        `Risk=${input.context?.risk_level ?? "medium"} and evidence_window=${input.evidence_window ?? input.evidence_limit ?? 20} shape the compute profile.`,
        "Use minimal mode for frequent polling or constrained trust-call budgets."
      ]
    };
  }

  makeSignedReceipt({ subjectId, sourceEnvironment, targetNetwork, payloadHash }) {
    const signature = `hmac-sha256:${crypto
      .createHmac("sha256", this.portabilitySigningKey)
      .update(payloadHash)
      .digest("hex")}`;
    const receipt = {
      receipt_id: makeId("rcp"),
      subject_id: subjectId,
      source_environment: sourceEnvironment,
      target_network: targetNetwork,
      signature,
      signed_fields: ["subject_id", "source_environment", "target_network", "payload_hash"]
    };
    this.db
      .prepare(
        "INSERT INTO portability_receipts (receipt_id, subject_id, direction, source_environment, target_network, payload_hash, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(receipt.receipt_id, subjectId, "export", sourceEnvironment, targetNetwork, payloadHash, signature, nowIso());
    return receipt;
  }

  verifyPortabilityReceipt(bundle) {
    const payloadHash = hashPayload({
      subject_id: bundle.subject?.subject_id,
      source_environment: bundle.source_environment,
      target_network: bundle.receipt?.target_network,
      snapshot_version: bundle.snapshot?.snapshot_version ?? null,
      evidence_ids: (bundle.evidence ?? []).map((entry) => entry.evidence_id),
      trace_refs: bundle.trace_refs ?? []
    });
    const expected = `hmac-sha256:${crypto
      .createHmac("sha256", this.portabilitySigningKey)
      .update(payloadHash)
      .digest("hex")}`;
    return {
      verified: expected === bundle.receipt?.signature,
      payload_hash: payloadHash
    };
  }

  idempotent(endpoint, key, requestBody, handler) {
    if (!key) {
      return handler();
    }
    const requestHash = hashPayload(requestBody);
    const existing = this.db.prepare("SELECT endpoint, request_hash, response_body FROM idempotency_keys WHERE key = ?").get(key);
    if (existing) {
      if (existing.endpoint !== endpoint || existing.request_hash !== requestHash) {
        throw appError({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency conflict.",
          statusCode: 409,
          details: { endpoint, key },
          suggestedActions: ["use_new_idempotency_key"]
        });
      }
      return JSON.parse(existing.response_body);
    }
    const responseBody = handler();
    this.db
      .prepare("INSERT INTO idempotency_keys (key, endpoint, request_hash, response_body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(key, endpoint, requestHash, JSON.stringify(responseBody), nowIso());
    return responseBody;
  }

  getPassport(subjectId) {
    return toPassport(
      this.db.prepare("SELECT * FROM passports WHERE subject_id = ?").get(subjectId),
      this.db
    );
  }

  listWebhooks() {
    return this.db
      .prepare("SELECT * FROM webhooks WHERE status = 'active' ORDER BY created_at ASC")
      .all()
      .map((row) => ({ ...toWebhook(row), _secret: row.secret }));
  }

  signWebhookPayload(secret, payload) {
    return `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
  }

  webhookMatches(event, webhook) {
    const typeMatch = webhook.event_types.length === 0 || webhook.event_types.includes(event.type) || webhook.event_types.includes(event.event_type);
    const subjectMatch = webhook.subjects.length === 0 || webhook.subjects.includes(event.subject) || webhook.subjects.includes(event.subject_id);
    return typeMatch && subjectMatch;
  }

  scheduleWebhookRetry({ deliveryId, webhook, event, nextAttempt }) {
    const delayMs = Math.min(2000, this.webhookRetryBaseMs * 2 ** Math.max(0, nextAttempt - 1));
    const timer = setTimeout(() => {
      this.webhookTimers.delete(timer);
      void this.deliverWebhook({ deliveryId, webhook, event, attempt: nextAttempt });
    }, delayMs);
    this.webhookTimers.add(timer);
  }

  async deliverWebhook({ deliveryId, webhook, event, attempt = 1 }) {
    const payload = JSON.stringify(event);
    const now = nowIso();
    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-infopunks-event-id": event.id,
          "x-infopunks-webhook-id": webhook.webhook_id,
          "x-infopunks-attempt": String(attempt),
          "x-infopunks-signature": this.signWebhookPayload(webhook._secret, payload)
        },
        body: payload
      });
      if (!response.ok) {
        throw appError({
          code: "TEMPORARY_UNAVAILABLE",
          message: `Webhook delivery failed with status ${response.status}.`,
          statusCode: 503,
          details: {
            webhook_id: webhook.webhook_id,
            response_status: response.status
          }
        });
      }
      this.db
        .prepare("UPDATE webhook_deliveries SET attempt_count = ?, status = ?, response_status = ?, last_error = NULL, next_attempt_at = NULL, updated_at = ? WHERE delivery_id = ?")
        .run(attempt, "succeeded", response.status, now, deliveryId);
      this.emitEvent({
        type: "webhook.delivery.succeeded",
        subject: event.subject_id,
        traceId: event.trace_id ?? null,
        data: {
          delivery_id: deliveryId,
          webhook_id: webhook.webhook_id,
          event_id: event.id,
          attempt_count: attempt,
          response_status: response.status
        },
        source: "infopunks.event-rail",
        dispatchWebhooks: false
      });
    } catch (error) {
      const normalized = normalizeError(error);
      const shouldRetry = attempt < webhook.max_attempts;
      const nextAttemptAt = shouldRetry
        ? new Date(Date.now() + Math.min(2000, this.webhookRetryBaseMs * 2 ** Math.max(0, attempt))).toISOString()
        : null;
      this.db
        .prepare("UPDATE webhook_deliveries SET attempt_count = ?, status = ?, response_status = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE delivery_id = ?")
        .run(
          attempt,
          shouldRetry ? "retry_scheduled" : "failed",
          normalized.details?.response_status ?? null,
          normalized.message,
          nextAttemptAt,
          now,
          deliveryId
        );
      this.emitEvent({
        type: "webhook.delivery.failed",
        subject: event.subject_id,
        traceId: event.trace_id ?? null,
        data: {
          delivery_id: deliveryId,
          webhook_id: webhook.webhook_id,
          event_id: event.id,
          attempt_count: attempt,
          will_retry: shouldRetry,
          next_attempt_at: nextAttemptAt
        },
        source: "infopunks.event-rail",
        dispatchWebhooks: false
      });
      if (shouldRetry) {
        this.scheduleWebhookRetry({ deliveryId, webhook, event, nextAttempt: attempt + 1 });
      }
    }
  }

  dispatchWebhooks(event) {
    for (const webhook of this.listWebhooks()) {
      if (!this.webhookMatches(event, webhook)) {
        continue;
      }
      const createdAt = nowIso();
      const deliveryId = makeId("whd");
      this.db
        .prepare(
          "INSERT INTO webhook_deliveries (delivery_id, webhook_id, event_id, attempt_count, status, response_status, last_error, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(deliveryId, webhook.webhook_id, event.id, 0, "pending", null, null, createdAt, createdAt, createdAt);
      void this.deliverWebhook({ deliveryId, webhook, event, attempt: 1 });
    }
  }

  createWebhook(input) {
    const existing = this.db.prepare("SELECT webhook_id FROM webhooks WHERE url = ?").get(input.url);
    if (existing) {
      throw appError({
        code: "CONFLICTING_EVIDENCE",
        message: "Webhook already registered for URL.",
        statusCode: 409,
        details: { url: input.url },
        suggestedActions: ["use_unique_webhook_url"]
      });
    }
    const createdAt = nowIso();
    const webhookId = makeId("whk");
    this.db
      .prepare(
        "INSERT INTO webhooks (webhook_id, url, secret, status, event_types, subjects, max_attempts, signing_alg, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        webhookId,
        input.url,
        input.secret,
        "active",
        JSON.stringify(input.event_types ?? []),
        JSON.stringify(input.subjects ?? []),
        Number(input.max_attempts ?? 3),
        "hmac-sha256",
        createdAt,
        createdAt
      );
    return toWebhook(
      this.db.prepare("SELECT * FROM webhooks WHERE webhook_id = ?").get(webhookId)
    );
  }

  exportTrustBundle(input) {
    const passport = this.ensureSubject(input.subject_id);
    const snapshot = this.getSnapshot(input.subject_id) ?? this.recomputeSnapshot(input.subject_id);
    const evidenceLimit = Math.max(1, Number(input.evidence_limit ?? 25));
    const evidence = input.include_evidence === false ? [] : this.listEvidence(input.subject_id).slice(0, evidenceLimit);
    const traceRefs =
      input.include_trace_ids === false
        ? []
        : this.db
            .prepare("SELECT trace_id FROM traces WHERE subject_id = ? ORDER BY created_at DESC LIMIT 20")
            .all(input.subject_id)
            .map((row) => row.trace_id);
    const payloadHash = hashPayload({
      subject_id: passport.subject_id,
      source_environment: this.environment,
      target_network: input.target_network ?? this.environment,
      snapshot_version: snapshot.snapshot_version,
      evidence_ids: evidence.map((entry) => entry.evidence_id),
      trace_refs: traceRefs
    });
    const receipt = this.makeSignedReceipt({
      subjectId: passport.subject_id,
      sourceEnvironment: this.environment,
      targetNetwork: input.target_network ?? this.environment,
      payloadHash
    });
    const bundle = {
      resource_type: "trust_portability_bundle",
      format_version: "trust_portability_bundle@1.0.0",
      source_environment: this.environment,
      exported_at: nowIso(),
      subject: passport,
      snapshot,
      evidence,
      trace_refs: traceRefs,
      receipt
    };
    this.emitEvent({
      type: "trust.portability.exported",
      subject: input.subject_id,
      traceId: null,
      data: {
        receipt_id: receipt.receipt_id,
        target_network: receipt.target_network,
        evidence_count: evidence.length,
        trace_ref_count: traceRefs.length,
        occurred_at: bundle.exported_at
      },
      source: "infopunks.portability-service"
    });
    return bundle;
  }

  importTrustBundle(input) {
    const bundle = input.bundle;
    const verification = this.verifyPortabilityReceipt(bundle);
    if (!verification.verified) {
      throw appError({
        code: "INVALID_REQUEST",
        message: "Portability bundle receipt verification failed.",
        statusCode: 400,
        details: {
          subject_id: bundle.subject?.subject_id ?? null
        },
        suggestedActions: ["export_bundle_again", "verify_signing_key"]
      });
    }

    const subjectId = bundle.subject.subject_id;
    const existingPassport = this.getPassport(subjectId);
    if (!existingPassport) {
      this.createPassport(
        {
          subject_id: bundle.subject.subject_id,
          subject_type: bundle.subject.subject_type,
          did: bundle.subject.did ?? undefined,
          issuer: bundle.subject.issuer,
          public_keys: bundle.subject.public_keys,
          capabilities: bundle.subject.capabilities,
          reputation_scope_defaults: bundle.subject.reputation_scope_defaults,
          metadata: {
            ...(bundle.subject.metadata ?? {}),
            imported_from_environment: bundle.source_environment,
            imported_receipt_id: bundle.receipt.receipt_id
          }
        },
        `import-passport-${bundle.receipt.receipt_id}`
      );
    }

    let importedEvidenceCount = 0;
    for (const evidence of bundle.evidence ?? []) {
      const evidenceHash = computeEvidenceFingerprint(evidence);
      const exists =
        this.db.prepare("SELECT evidence_id FROM evidence_records WHERE evidence_id = ?").get(evidence.evidence_id) ??
        this.db.prepare("SELECT evidence_id FROM evidence_records WHERE evidence_hash = ?").get(evidenceHash);
      if (exists) {
        continue;
      }
      this.persistEvidenceRecord({
        evidenceId: evidence.evidence_id,
        evidenceHash,
        input: evidence,
        createdAt: evidence.created_at ?? nowIso()
      });
      importedEvidenceCount += 1;
    }

    if (bundle.snapshot && (!this.getSnapshot(subjectId) || input.import_mode === "mirror")) {
      this.db
        .prepare(
          "INSERT INTO trust_snapshots (subject_id, snapshot_version, vector, aggregate_counts, last_event_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(subject_id) DO UPDATE SET snapshot_version = excluded.snapshot_version, vector = excluded.vector, aggregate_counts = excluded.aggregate_counts, last_event_at = excluded.last_event_at, updated_at = excluded.updated_at"
        )
        .run(
          bundle.snapshot.subject_id,
          bundle.snapshot.snapshot_version,
          JSON.stringify(bundle.snapshot.vector ?? {}),
          JSON.stringify(bundle.snapshot.aggregate_counts ?? {}),
          bundle.snapshot.last_event_at,
          bundle.snapshot.updated_at ?? nowIso()
        );
    } else if (importedEvidenceCount > 0) {
      this.recomputeSnapshot(subjectId);
    }

    this.db
      .prepare(
        "INSERT INTO portability_receipts (receipt_id, subject_id, direction, source_environment, target_network, payload_hash, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        bundle.receipt.receipt_id,
        subjectId,
        "import",
        bundle.source_environment,
        bundle.receipt.target_network ?? this.environment,
        verification.payload_hash,
        bundle.receipt.signature,
        nowIso()
      );

    this.emitEvent({
      type: "trust.portability.imported",
      subject: subjectId,
      traceId: null,
      data: {
        receipt_id: bundle.receipt.receipt_id,
        source_environment: bundle.source_environment,
        imported_evidence_count: importedEvidenceCount,
        import_mode: input.import_mode ?? "merge",
        occurred_at: nowIso()
      },
      source: "infopunks.portability-service"
    });

    return {
      imported: true,
      subject_id: subjectId,
      imported_evidence_count: importedEvidenceCount,
      imported_trace_refs: bundle.trace_refs ?? [],
      import_mode: input.import_mode ?? "merge",
      receipt_verified: true
    };
  }

  getEscrowQuote(input) {
    const resolution = this.resolveTrust({
      subject_id: input.subject_id,
      context: input.context,
      response_mode: "standard"
    });
    const ratioByBand = {
      privileged: 0.04,
      preferred: 0.08,
      allowed: 0.15,
      watch: 0.3,
      restricted: 0.55,
      quarantined: 1
    };
    const riskMultiplier =
      input.context?.risk_level === "high" ? 1.25 : input.context?.risk_level === "low" ? 0.85 : 1;
    const escrowRatio = round(clamp(0, ratioByBand[resolution.band] * riskMultiplier, 1), 4);
    const quote = {
      subject_id: input.subject_id,
      trust_band: resolution.band,
      escrow_ratio: escrowRatio,
      escrow_amount_usd: round(Number(input.notional_usd ?? 0) * escrowRatio, 4),
      rationale: [
        `Escrow ratio derived from trust band ${resolution.band}.`,
        `Risk level ${input.context?.risk_level ?? "medium"} adjusted the baseline requirement.`,
        "Use higher escrow when trust is weak, confidence is low, or validator escalation is required."
      ],
      policy_extensions: {
        extension_interface: "economic_hooks@v1",
        recommended_release_rule: resolution.decision === "allow" ? "release_on_completion" : "release_on_quorum_validation"
      }
    };
    this.emitEvent({
      type: "economic.escrow.quoted",
      subject: input.subject_id,
      traceId: resolution.trace_id,
      data: {
        escrow_ratio: quote.escrow_ratio,
        escrow_amount_usd: quote.escrow_amount_usd,
        occurred_at: nowIso()
      },
      source: "infopunks.economic-hooks"
    });
    return quote;
  }

  getRiskPriceQuote(input) {
    const resolution = this.resolveTrust({
      subject_id: input.subject_id,
      context: input.context,
      response_mode: "standard"
    });
    const snapshot = this.getSnapshot(input.subject_id) ?? this.recomputeSnapshot(input.subject_id);
    const riskFactors = {
      dispute_rate: Number(snapshot.vector.dispute_rate ?? 0),
      collusion_risk: Number(snapshot.vector.collusion_risk ?? 0),
      freshness_decay: round(1 - Number(snapshot.vector.freshness ?? 0), 4),
      sockpuppet_risk: Number(snapshot.vector.sockpuppet_risk ?? 0),
      validator_bribery_risk: Number(snapshot.vector.validator_bribery_risk ?? 0)
    };
    const notional = Number(input.notional_usd ?? 1000);
    const durationHours = Number(input.duration_hours ?? 24);
    const premiumBps = Math.max(
      25,
      Math.round(
        50 +
          (100 - resolution.score) * 1.8 +
          riskFactors.collusion_risk * 120 +
          riskFactors.dispute_rate * 90 +
          riskFactors.validator_bribery_risk * 75 +
          Math.log10(durationHours + 1) * 20
      )
    );
    const quote = {
      subject_id: input.subject_id,
      premium_bps: premiumBps,
      premium_usd: round((notional * premiumBps) / 10000, 4),
      risk_factors: riskFactors,
      policy_extensions: {
        extension_interface: "economic_hooks@v1",
        recommended_underwriting_mode: resolution.band === "privileged" ? "auto-bind" : "review-before-bind"
      }
    };
    this.emitEvent({
      type: "economic.risk_priced",
      subject: input.subject_id,
      traceId: resolution.trace_id,
      data: {
        premium_bps: quote.premium_bps,
        premium_usd: quote.premium_usd,
        occurred_at: nowIso()
      },
      source: "infopunks.economic-hooks"
    });
    return quote;
  }

  getAttestationBundle(input) {
    const resolution = this.resolveTrust({
      subject_id: input.subject_id,
      context: input.context,
      response_mode: "standard"
    });
    const evidence = this.listEvidence(input.subject_id).slice(0, Number(input.evidence_limit ?? 10));
    const payloadHash = hashPayload({
      subject_id: input.subject_id,
      trace_id: resolution.trace_id,
      evidence_ids: evidence.map((entry) => entry.evidence_id),
      score: resolution.score,
      band: resolution.band
    });
    const signature = `hmac-sha256:${crypto
      .createHmac("sha256", this.portabilitySigningKey)
      .update(payloadHash)
      .digest("hex")}`;
    const bundle = {
      resource_type: "attestation_bundle",
      attestation_id: makeId("att"),
      subject_id: input.subject_id,
      issued_at: nowIso(),
      trust_summary: {
        score: resolution.score,
        band: resolution.band,
        confidence: resolution.confidence,
        decision: resolution.decision
      },
      evidence_refs: evidence.map((entry) => entry.evidence_id),
      attestors: [
        resolution.trace_id,
        resolution.engine_version,
        resolution.policy_version
      ],
      policy_extensions: {
        extension_interface: "economic_hooks@v1",
        attestation_scope: input.context?.domain ?? "general"
      },
      signature
    };
    this.emitEvent({
      type: "economic.attestation.issued",
      subject: input.subject_id,
      traceId: resolution.trace_id,
      data: {
        attestation_id: bundle.attestation_id,
        evidence_count: bundle.evidence_refs.length,
        occurred_at: bundle.issued_at
      },
      source: "infopunks.economic-hooks"
    });
    return bundle;
  }

  setPassportStatus(subjectId, status) {
    const passport = this.getPassport(subjectId);
    if (!passport) {
      throw appError({
        code: "UNKNOWN_SUBJECT",
        message: `Unknown subject ${subjectId}`,
        statusCode: 404,
        details: { subject_id: subjectId },
        suggestedActions: ["register_subject"]
      });
    }
    const updatedAt = nowIso();
    const metadata = {
      ...(passport.metadata ?? {}),
      issuer_signature: passport.issuer?.signature ?? "ed25519:self-issued-v1",
      issuer_provenance: passport.issuer?.provenance ?? {
        trust_anchor: "infopunks-local-root",
        verification_method: "self_attested_signature",
        issued_at: passport.created_at
      },
      reputation_scope_defaults: passport.reputation_scope_defaults,
      portability: passport.portability,
      lifecycle: {
        ...(passport.lifecycle ?? {}),
        status_reason: status === "revoked" ? "passport_revoked_event" : "operator_suspension",
        last_status_change_at: updatedAt,
        last_key_rotation_at: passport.lifecycle?.last_key_rotation_at ?? null
      }
    };
    this.db
      .prepare("UPDATE passports SET status = ?, metadata = ?, updated_at = ? WHERE subject_id = ?")
      .run(status, JSON.stringify(metadata), updatedAt, subjectId);
    const updated = this.getPassport(subjectId);
    this.emitEvent({
      type: status === "revoked" ? "passport.revoked" : "passport.suspended",
      subject: subjectId,
      traceId: null,
      data: {
        passport_id: updated.passport_id,
        status,
        lifecycle: updated.lifecycle
      },
      source: "infopunks.passport-service"
    });
    return updated;
  }

  ensureSubject(subjectId) {
    const passport = this.getPassport(subjectId);
    if (!passport) {
      throw appError({
        code: "UNKNOWN_SUBJECT",
        message: `Unknown subject ${subjectId}`,
        statusCode: 404,
        details: { subject_id: subjectId },
        suggestedActions: ["register_subject"]
      });
    }
    if (passport.status === "revoked") {
      throw appError({
        code: "PASSPORT_REVOKED",
        message: `Passport revoked for ${subjectId}`,
        statusCode: 409,
        details: { subject_id: subjectId },
        suggestedActions: ["register_new_passport"]
      });
    }
    if (passport.status === "suspended") {
      throw appError({
        code: "PASSPORT_SUSPENDED",
        message: `Passport suspended for ${subjectId}`,
        statusCode: 409,
        details: { subject_id: subjectId },
        suggestedActions: ["escalate_to_operator"]
      });
    }
    return passport;
  }

  createPassport(input, idempotencyKey) {
    return this.idempotent("/v1/passports", idempotencyKey, input, () => {
      if (!input.subject_id || !SUBJECT_TYPES.includes(input.subject_type)) {
        throw appError({
          code: "INVALID_REQUEST",
          message: "Invalid subject.",
          statusCode: 400,
          suggestedActions: ["fix_request_payload"]
        });
      }
      if (input.did) {
        const didExists = this.db.prepare("SELECT passport_id FROM passports WHERE did = ?").get(input.did);
        if (didExists) {
          throw appError({
            code: "CONFLICTING_EVIDENCE",
            message: "DID already registered.",
            statusCode: 409,
            details: { did: input.did },
            suggestedActions: ["use_unique_did"]
          });
        }
      }
      const subjectExists = this.db.prepare("SELECT passport_id FROM passports WHERE subject_id = ?").get(input.subject_id);
      if (subjectExists) {
        throw appError({
          code: "CONFLICTING_EVIDENCE",
          message: "Subject already registered.",
          statusCode: 409,
          details: { subject_id: input.subject_id },
          suggestedActions: ["use_unique_subject_id"]
        });
      }

      const createdAt = nowIso();
      const passportId = makeId("psp");
      const metadata = {
        ...(input.metadata ?? {}),
        issuer_signature: input.issuer?.signature ?? "ed25519:self-issued-v1",
        issuer_provenance: input.issuer?.provenance ?? {
          trust_anchor: "infopunks-local-root",
          verification_method: "self_attested_signature",
          issued_at: createdAt
        },
        reputation_scope_defaults:
          input.reputation_scope_defaults ?? {
            domains: [],
            risk_tolerance: "medium"
          },
        portability: {
          portable_format: "passport_bundle@v1",
          exportable: true,
          scope_defaults_included: true,
          issuer_attested: Boolean(input.issuer?.signature ?? "ed25519:self-issued-v1")
        },
        lifecycle: {
          status_reason: null,
          last_status_change_at: createdAt,
          last_key_rotation_at: null
        }
      };
      this.db
        .prepare(
          "INSERT INTO passports (passport_id, subject_id, subject_type, did, status, issuer_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          passportId,
          input.subject_id,
          input.subject_type,
          input.did ?? null,
          "active",
          input.issuer?.issuer_id ?? "org_infopunks",
          JSON.stringify(metadata),
          createdAt,
          createdAt
        );

      const insertKey = this.db.prepare(
        "INSERT INTO passport_keys (passport_id, kid, alg, public_key, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      for (const key of input.public_keys ?? []) {
        insertKey.run(passportId, key.kid, key.alg, key.public_key, createdAt);
      }
      const insertCapability = this.db.prepare(
        "INSERT INTO passport_capabilities (passport_id, name, version, verified, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      for (const capability of input.capabilities ?? []) {
        insertCapability.run(passportId, capability.name, capability.version, capability.verified ? 1 : 0, createdAt);
      }

      this.emitEvent({
        type: "passport.created",
        subject: input.subject_id,
        traceId: null,
        data: { passport_id: passportId, status: "active", portability: metadata.portability, occurred_at: createdAt },
        source: "infopunks.passport-service"
      });

      return {
        passport_id: passportId,
        subject_id: input.subject_id,
        status: "active",
        issuer: {
          issuer_id: input.issuer?.issuer_id ?? "org_infopunks",
          signature: input.issuer?.signature ?? "ed25519:self-issued-v1",
          provenance: metadata.issuer_provenance
        },
        created_at: createdAt
      };
    });
  }

  rotatePassportKey(subjectId, input) {
    const passport = this.ensureSubject(subjectId);
    const createdAt = nowIso();
    const existing = this.db
      .prepare("SELECT id FROM passport_keys WHERE passport_id = ? AND kid = ?")
      .get(passport.passport_id, input.key.kid);
    if (existing) {
      throw appError({
        code: "CONFLICTING_EVIDENCE",
        message: "Passport key kid already exists.",
        statusCode: 409,
        details: { subject_id: subjectId, kid: input.key.kid },
        suggestedActions: ["use_unique_kid"]
      });
    }
    this.db
      .prepare("INSERT INTO passport_keys (passport_id, kid, alg, public_key, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(passport.passport_id, input.key.kid, input.key.alg, input.key.public_key, createdAt);
    const metadata = {
      ...(passport.metadata ?? {}),
      issuer_signature: passport.issuer?.signature ?? "ed25519:self-issued-v1",
      issuer_provenance: passport.issuer?.provenance ?? {
        trust_anchor: "infopunks-local-root",
        verification_method: "self_attested_signature",
        issued_at: passport.created_at
      },
      reputation_scope_defaults: passport.reputation_scope_defaults,
      portability: passport.portability,
      lifecycle: {
        ...(passport.lifecycle ?? {}),
        last_status_change_at: passport.lifecycle?.last_status_change_at ?? passport.updated_at,
        last_key_rotation_at: createdAt,
        status_reason: input.reason ?? passport.lifecycle?.status_reason ?? null
      }
    };
    this.db
      .prepare("UPDATE passports SET metadata = ?, updated_at = ? WHERE passport_id = ?")
      .run(JSON.stringify(metadata), createdAt, passport.passport_id);
    this.emitEvent({
      type: "passport.key_rotated",
      subject: subjectId,
      traceId: null,
      data: {
        passport_id: passport.passport_id,
        kid: input.key.kid,
        reason: input.reason ?? null,
        occurred_at: createdAt
      },
      source: "infopunks.passport-service"
    });
    return this.getPassport(subjectId);
  }

  listEvidence(subjectId) {
    return this.db
      .prepare("SELECT * FROM evidence_records WHERE subject_id = ? ORDER BY created_at DESC, evidence_id DESC")
      .all(subjectId)
      .map((row) => toEvidence(row, this.db));
  }

  getSnapshot(subjectId) {
    return toSnapshot(this.db.prepare("SELECT * FROM trust_snapshots WHERE subject_id = ?").get(subjectId));
  }

  getEvidence(evidenceId) {
    const row = this.db.prepare("SELECT * FROM evidence_records WHERE evidence_id = ?").get(evidenceId);
    return row ? toEvidence(row, this.db) : null;
  }

  persistEvidenceRecord({ evidenceId = makeId("ev"), evidenceHash, input, createdAt }) {
    this.db
      .prepare(
        "INSERT INTO evidence_records (evidence_id, evidence_hash, subject_id, event_type, task_id, context, outcome, disputes, provenance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        evidenceId,
        evidenceHash,
        input.subject_id,
        input.event_type,
        input.task_id ?? null,
        JSON.stringify(input.context ?? {}),
        JSON.stringify(input.outcome ?? {}),
        JSON.stringify(input.disputes ?? []),
        JSON.stringify(input.provenance ?? {}),
        createdAt
      );

    const insertValidator = this.db.prepare(
      "INSERT INTO evidence_validators (evidence_id, validator_id, verdict, weight, reason_codes) VALUES (?, ?, ?, ?, ?)"
    );
    for (const validator of input.validators ?? []) {
      insertValidator.run(
        evidenceId,
        validator.validator_id,
        validator.verdict,
        Number(validator.weight ?? 0),
        JSON.stringify(validator.reason_codes ?? [])
      );
    }
    return evidenceId;
  }

  recomputeSnapshot(subjectId) {
    const started = Date.now();
    const passport = this.ensureSubject(subjectId);
    const evidences = this.listEvidence(subjectId);
    const previousSnapshot = this.getSnapshot(subjectId);
    const relatedValidatorPassports = Object.fromEntries(
      [...new Set(evidences.flatMap((entry) => (entry.validators ?? []).map((validator) => validator.validator_id).filter(Boolean)))]
        .map((validatorId) => [validatorId, this.getPassport(validatorId)])
        .filter(([, validatorPassport]) => Boolean(validatorPassport))
    );
    const snapshot = computeSnapshot({
      subjectId,
      passport: {
        ...passport,
        related_validator_passports: relatedValidatorPassports
      },
      evidences,
      nowIso: nowIso(),
      previousSnapshot,
      policy: DEFAULT_POLICY
    });

    this.db
      .prepare(
        "INSERT INTO trust_snapshots (subject_id, snapshot_version, vector, aggregate_counts, last_event_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(subject_id) DO UPDATE SET snapshot_version = excluded.snapshot_version, vector = excluded.vector, aggregate_counts = excluded.aggregate_counts, last_event_at = excluded.last_event_at, updated_at = excluded.updated_at"
      )
      .run(
        subjectId,
        snapshot.snapshot_version,
        JSON.stringify(snapshot.vector),
        JSON.stringify(snapshot.aggregate_counts),
        snapshot.last_event_at,
        snapshot.updated_at
      );

    const previousCollusion = Number(previousSnapshot?.vector?.collusion_risk ?? 0);
    if (snapshot.vector.collusion_risk >= DEFAULT_POLICY.thresholds.mutual_validation_ratio_penalty && previousCollusion < DEFAULT_POLICY.thresholds.mutual_validation_ratio_penalty) {
      this.recordMetric("collusion_alert_total", 1);
      this.emitEvent({
        type: "collusion.suspected",
        subject: subjectId,
        traceId: null,
        data: {
          collusion_risk: snapshot.vector.collusion_risk,
          mutual_validation_ratio: snapshot.vector.mutual_validation_ratio,
          closed_cluster_density: snapshot.vector.closed_cluster_density,
          recommended_actions: ["exclude_from_validator_pool", "escalate_to_war_room"]
        },
        source: "infopunks.snapshot-aggregator"
      });
    }
    const previousClusterDensity = Number(previousSnapshot?.vector?.closed_cluster_density ?? 0);
    if (
      snapshot.vector.closed_cluster_density >= DEFAULT_POLICY.thresholds.closed_cluster_density_penalty &&
      previousClusterDensity < DEFAULT_POLICY.thresholds.closed_cluster_density_penalty
    ) {
      this.emitEvent({
        type: "cluster.instability_detected",
        subject: subjectId,
        traceId: null,
        data: {
          closed_cluster_density: snapshot.vector.closed_cluster_density,
          shared_cluster_dependency: snapshot.vector.shared_cluster_dependency,
          validator_diversity_score: snapshot.vector.validator_diversity_score,
          occurred_at: snapshot.updated_at
        },
        source: "infopunks.snapshot-aggregator"
      });
    }
    const previousValidationQuality = Number(previousSnapshot?.vector?.validation_quality ?? 1);
    if (
      passport.subject_type === "validator" &&
      snapshot.vector.validation_quality <= 0.45 &&
      previousValidationQuality > 0.45
    ) {
      this.emitEvent({
        type: "validator.drift_detected",
        subject: subjectId,
        traceId: null,
        data: {
          validation_quality: snapshot.vector.validation_quality,
          reversal_rate: snapshot.vector.reversal_rate,
          reversal_asymmetry: snapshot.vector.reversal_asymmetry,
          occurred_at: snapshot.updated_at
        },
        source: "infopunks.snapshot-aggregator"
      });
    }

    this.recordMetric("snapshot_update_duration_ms", Date.now() - started);
    return snapshot;
  }

  recordEvidence(input, idempotencyKey) {
    return this.idempotent("/v1/evidence", idempotencyKey, input, () => {
      if (!input.subject_id || !EVIDENCE_EVENT_TYPES.includes(input.event_type)) {
        throw appError({
          code: "INVALID_REQUEST",
          message: "Invalid evidence input.",
          statusCode: 400,
          suggestedActions: ["fix_request_payload"]
        });
      }
      this.ensureSubject(input.subject_id);
      const createdAt = input.created_at ?? nowIso();
      const evidenceHash = computeEvidenceFingerprint(input);
      const existing = this.db
        .prepare("SELECT evidence_id FROM evidence_records WHERE evidence_hash = ?")
        .get(evidenceHash);
      if (existing?.evidence_id) {
        return {
          evidence_id: existing.evidence_id,
          accepted: true,
          snapshot_update_status: "processed"
        };
      }
      const evidenceId = this.persistEvidenceRecord({
        evidenceHash,
        input,
        createdAt
      });

      this.recordMetric("evidence_ingest_total", 1);
      const snapshot = this.recomputeSnapshot(input.subject_id);
      this.emitEvent({
        type: input.event_type,
        subject: input.subject_id,
        traceId: input.provenance?.trace_id ?? null,
        data: {
          evidence_id: evidenceId,
          task_id: input.task_id ?? null,
          context: input.context ?? {},
          outcome: input.outcome ?? {},
          snapshot_version: snapshot.snapshot_version,
          occurred_at: createdAt
        },
        source: "infopunks.evidence-service"
      });
      if (input.event_type === "passport.revoked") {
        this.setPassportStatus(input.subject_id, "revoked");
      }

      return {
        evidence_id: evidenceId,
        accepted: true,
        snapshot_update_status: "processed"
      };
    });
  }

  evaluateDispute(input) {
    const passport = this.ensureSubject(input.subject_id);
    const evidences = (input.evidence_ids ?? [])
      .map((evidenceId) => this.getEvidence(evidenceId))
      .filter(Boolean)
      .sort(
        (left, right) =>
          new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
          left.evidence_id.localeCompare(right.evidence_id)
      );

    if (evidences.length !== (input.evidence_ids ?? []).length) {
      throw appError({
        code: "INSUFFICIENT_EVIDENCE",
        message: "One or more evidence records could not be resolved for dispute evaluation.",
        statusCode: 409,
        details: {
          subject_id: input.subject_id,
          requested_evidence_ids: input.evidence_ids ?? [],
          resolved_evidence_ids: evidences.map((entry) => entry.evidence_id)
        },
        suggestedActions: ["check_evidence_ids", "expand_evidence_window"]
      });
    }

    const mismatchedSubject = evidences.find((entry) => entry.subject_id !== input.subject_id);
    if (mismatchedSubject) {
      throw appError({
        code: "CONFLICTING_EVIDENCE",
        message: "Dispute evidence must belong to the disputed subject.",
        statusCode: 409,
        details: {
          subject_id: input.subject_id,
          conflicting_evidence_id: mismatchedSubject.evidence_id,
          evidence_subject_id: mismatchedSubject.subject_id
        },
        suggestedActions: ["use_subject_scoped_evidence"]
      });
    }

    if (input.task_id) {
      const mismatchedTask = evidences.find((entry) => entry.task_id && entry.task_id !== input.task_id);
      if (mismatchedTask) {
        throw appError({
          code: "CONFLICTING_EVIDENCE",
          message: "Task-scoped disputes must reference evidence from a single task.",
          statusCode: 409,
          details: {
            task_id: input.task_id,
            conflicting_evidence_id: mismatchedTask.evidence_id,
            evidence_task_id: mismatchedTask.task_id
          },
          suggestedActions: ["use_single_task_evidence_set"]
        });
      }
    }

    const snapshot = this.getSnapshot(input.subject_id) ?? this.recomputeSnapshot(input.subject_id);
    const evidenceCount = Math.max(1, evidences.length);
    const validatorIds = [...new Set(evidences.flatMap((entry) => (entry.validators ?? []).map((validator) => validator.validator_id).filter(Boolean)))];
    const validatorPassports = validatorIds
      .map((validatorId) => this.getPassport(validatorId))
      .filter(Boolean);
    const passVerdicts = evidences.flatMap((entry) => (entry.validators ?? []).filter((validator) => validator.verdict === "pass"));
    const failVerdicts = evidences.flatMap((entry) => (entry.validators ?? []).filter((validator) => validator.verdict === "fail"));
    const reversalCount = evidences.filter((entry) => entry.event_type === "validation.reversed").length;
    const failureCount = evidences.filter((entry) => ["task.failed", "task.timeout", "validation.failed"].includes(entry.event_type)).length;
    const contradictionScore = clamp(
      0,
      (failureCount + reversalCount * 1.35 + Math.max(0, failVerdicts.length - passVerdicts.length) * 0.35) / evidenceCount,
      1
    );
    const evidenceConsistency = round(
      clamp(
        0,
        1 -
          contradictionScore * 0.7 -
          Math.abs(passVerdicts.length - failVerdicts.length) / Math.max(1, passVerdicts.length + failVerdicts.length + 1) * 0.3,
        1
      ),
      2
    );
    const validatorDiversity = round(
      clamp(0, validatorIds.length / Math.max(1, DEFAULT_POLICY.thresholds.minimum_validator_diversity), 1),
      2
    );
    const sharedIssuerValidators = validatorPassports.filter(
      (validatorPassport) => validatorPassport.issuer?.issuer_id === passport.issuer?.issuer_id
    ).length;
    const sharedInfraValidators = validatorPassports.filter((validatorPassport) => {
      const validatorOwner = validatorPassport.metadata?.owner_org;
      const validatorFramework = validatorPassport.metadata?.framework;
      return (
        (passport.metadata?.owner_org && validatorOwner && passport.metadata.owner_org === validatorOwner) ||
        (passport.metadata?.framework && validatorFramework && passport.metadata.framework === validatorFramework)
      );
    }).length;
    const collusionRisk = round(
      clamp(
        0,
        Number(snapshot.vector.collusion_risk ?? 0) * 0.55 +
          Number(snapshot.vector.shared_issuer_ratio ?? 0) * 0.2 +
          Number(snapshot.vector.shared_infra_ratio ?? 0) * 0.15 +
          (sharedIssuerValidators / Math.max(1, validatorIds.length)) * 0.06 +
          (sharedInfraValidators / Math.max(1, validatorIds.length)) * 0.04,
        1
      ),
      2
    );
    const maxCapitalExposure = Math.max(
      0,
      ...evidences.map((entry) => Number(entry.context?.capital_exposure_usd ?? 0)),
      Number(input.context?.capital_exposure_usd ?? 0)
    );
    const highRiskContexts =
      evidences.filter((entry) => (entry.context?.risk_level ?? input.context?.risk_level) === "high").length / evidenceCount;
    const severityWeight = {
      low: 0.2,
      medium: 0.45,
      high: 0.7,
      critical: 0.9
    }[input.severity] ?? 0.45;
    const economicRisk = round(
      clamp(
        0,
        clamp(0, Math.log10(maxCapitalExposure + 1) / 5, 1) * 0.45 + highRiskContexts * 0.35 + severityWeight * 0.2,
        1
      ),
      2
    );
    const reversalImpact = round(
      clamp(
        0,
        Number(snapshot.vector.reversal_asymmetry ?? 0) * 0.55 +
          Number(snapshot.vector.reversal_rate ?? 0) * 0.2 +
          (reversalCount / evidenceCount) * 0.25,
        1
      ),
      2
    );

    let recommendedResolution = "uphold_current_trust";
    if (collusionRisk >= 0.72 || (economicRisk >= 0.75 && reversalImpact >= 0.55)) {
      recommendedResolution = "quarantine_subject";
    } else if (reversalImpact >= 0.45 || contradictionScore >= 0.62) {
      recommendedResolution = "reverse_validation_credit";
    } else if (evidenceConsistency < 0.58 || validatorDiversity < 0.5) {
      recommendedResolution = "request_additional_validation";
    }
    recommendedResolution = stricterResolution(recommendedResolution, input.preferred_resolution);

    const status = recommendedResolution === "request_additional_validation" ? "opened" : "resolved";
    const createdAt = nowIso();
    const disputeId = makeId("dsp");
    const traceId = makeId("trc");
    const taskId = input.task_id ?? evidences.find((entry) => entry.task_id)?.task_id ?? null;
    const actionsByResolution = {
      uphold_current_trust: ["retain_current_routing"],
      request_additional_validation: ["request_additional_validation", "retain_current_limits"],
      reverse_validation_credit: ["reverse_recent_validation_credit", "reroute_pending_tasks"],
      quarantine_subject: ["quarantine_subject", "reroute_pending_tasks", "escalate_to_war_room"]
    };
    const actions = [...actionsByResolution[recommendedResolution]];
    if (collusionRisk >= 0.5 && !actions.includes("exclude_shared_cluster_validators")) {
      actions.push("exclude_shared_cluster_validators");
    }
    if (economicRisk >= 0.65 && !actions.includes("limit_capital_exposure")) {
      actions.push("limit_capital_exposure");
    }

    const disputeMetadata = [
      {
        dispute_id: disputeId,
        status,
        reason_code: input.reason_code,
        opened_at: createdAt,
        disputed_by: input.disputed_by ?? "unknown"
      }
    ];
    const disputeOpenedEvidence = this.recordEvidence({
      subject_id: input.subject_id,
      event_type: "dispute.opened",
      task_id: taskId,
      context: input.context ?? {},
      outcome: {
        status: "opened",
        confidence_score: round(1 - contradictionScore, 2)
      },
      validators: [],
      disputes: disputeMetadata,
      provenance: {
        source_system: "dispute-service",
        trace_id: traceId
      }
    });
    let disputeResolvedEvidence = null;
    if (status === "resolved") {
      disputeResolvedEvidence = this.recordEvidence({
        subject_id: input.subject_id,
        event_type: "dispute.resolved",
        task_id: taskId,
        context: input.context ?? {},
        outcome: {
          status: recommendedResolution,
          confidence_score: round(1 - contradictionScore, 2)
        },
        validators: [],
        disputes: [
          {
            ...disputeMetadata[0],
            status: "resolved",
            resolved_at: createdAt
          }
        ],
        provenance: {
          source_system: "dispute-service",
          trace_id: traceId
        }
      });
    }

    const evaluation = {
      contradiction_score: round(contradictionScore, 2),
      evidence_consistency: evidenceConsistency,
      validator_diversity: validatorDiversity,
      collusion_risk: collusionRisk,
      economic_risk: economicRisk,
      reversal_impact: reversalImpact,
      recommended_resolution: recommendedResolution
    };
    const disputeEvaluation = {
      dispute_id: disputeId,
      subject_id: input.subject_id,
      task_id: taskId,
      status,
      severity: input.severity,
      reason_code: input.reason_code,
      evidence_ids: evidences.map((entry) => entry.evidence_id),
      evaluation,
      actions,
      trace_id: traceId,
      created_at: createdAt
    };

    this.db
      .prepare(
        "INSERT INTO dispute_evaluations (dispute_id, subject_id, task_id, reason_code, severity, status, evidence_ids, evaluation, actions, trace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        disputeEvaluation.dispute_id,
        disputeEvaluation.subject_id,
        disputeEvaluation.task_id,
        disputeEvaluation.reason_code,
        disputeEvaluation.severity,
        disputeEvaluation.status,
        JSON.stringify(disputeEvaluation.evidence_ids),
        JSON.stringify(disputeEvaluation.evaluation),
        JSON.stringify(disputeEvaluation.actions),
        disputeEvaluation.trace_id,
        disputeEvaluation.created_at
      );

    const trace = {
      trace_id: traceId,
      subject_id: input.subject_id,
      resolution_id: null,
      routing_id: null,
      input_refs: {
        passport_id: passport.passport_id,
        snapshot_version: snapshot.snapshot_version,
        evidence_ids: disputeEvaluation.evidence_ids,
        dispute_lifecycle_evidence_ids: [
          disputeOpenedEvidence.evidence_id,
          disputeResolvedEvidence?.evidence_id ?? null
        ].filter(Boolean)
      },
      context: input.context ?? {},
      scoring: {
        engine_version: "dispute-engine@1.0.0",
        policy_version: `${DEFAULT_POLICY.policy_id}@${DEFAULT_POLICY.version}`,
        components: evaluation
      },
      outputs: disputeEvaluation,
      created_at: createdAt
    };
    this.db
      .prepare(
        "INSERT INTO traces (trace_id, subject_id, resolution_id, routing_id, input_refs, context, scoring, outputs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        trace.trace_id,
        trace.subject_id,
        null,
        null,
        JSON.stringify(trace.input_refs),
        JSON.stringify(trace.context),
        JSON.stringify(trace.scoring),
        JSON.stringify(trace.outputs),
        trace.created_at
      );

    if (input.severity === "critical" || recommendedResolution === "quarantine_subject") {
      this.emitEvent({
        type: "warroom.alerted",
        subject: input.subject_id,
        traceId,
        data: {
          alert_kind: "dispute_evaluation",
          severity: input.severity,
          recommended_resolution: recommendedResolution,
          actions
        },
        source: "infopunks.dispute-service"
      });
    }

    return disputeEvaluation;
  }

  recommendValidators(subjectId, context, policy, exclude = new Set(), candidateValidators = null) {
    const rows = candidateValidators?.length
      ? candidateValidators.map((candidateId) => ({ subject_id: candidateId }))
      : this.db.prepare("SELECT subject_id FROM passports WHERE subject_id != ? AND status = 'active'").all(subjectId);
    const candidates = [];
    for (const row of rows) {
      if (exclude.has(row.subject_id)) {
        continue;
      }
      const passport = this.getPassport(row.subject_id);
      const snapshot = this.getSnapshot(row.subject_id) ?? this.recomputeSnapshot(row.subject_id);
      const resolution = computeResolution({
        passport,
        snapshot,
        context,
        policy,
        nowIso: nowIso()
      });
      const domainFit = Number(snapshot.vector.domain_competence?.[context.domain] ?? 0.2);
      if (!validationEligible(resolution.band, context, policy)) {
        continue;
      }
      if (snapshot.vector.collusion_risk >= 0.55) {
        continue;
      }
      candidates.push({
        subject_id: row.subject_id,
        score: resolution.score,
        fit_score: round(clamp(0, 0.8 * domainFit + 0.2 * resolution.confidence, 1), 2)
      });
    }
    candidates.sort((a, b) => b.fit_score - a.fit_score || b.score - a.score || a.subject_id.localeCompare(b.subject_id));
    return candidates.slice(0, 3);
  }

  resolveTrust(input) {
    const started = Date.now();
    const passport = this.ensureSubject(input.subject_id);
    const policy = this.getPolicy(input.policy_id, input.policy_version);
    const snapshot = this.getSnapshot(input.subject_id) ?? this.recomputeSnapshot(input.subject_id);
    const context = input.context ?? {};
    const contextHash = stableHash({
      subject_id: input.subject_id,
      context,
      policy_id: policy.policy_id,
      policy_version: policy.version
    });
    const computed = computeResolution({
      passport,
      snapshot,
      context,
      policy,
      nowIso: nowIso()
    });
    const recommendedValidators = this.recommendValidators(
      input.subject_id,
      context,
      policy,
      new Set([input.subject_id]),
      input.candidate_validators ?? null
    );
    const previousResolution = toResolution(
      this.db
        .prepare("SELECT * FROM trust_resolutions WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(input.subject_id)
    );
    const resolutionId = makeId("trs");
    const traceId = makeId("trc");
    const createdAt = nowIso();
    const evidences = this.listEvidence(input.subject_id).slice(0, 20);
    const resolution = {
      resolution_id: resolutionId,
      subject_id: input.subject_id,
      context_hash: contextHash,
      score: computed.score,
      band: computed.band,
      confidence: computed.confidence,
      decision: computed.decision,
      reason_codes: computed.reason_codes,
      recommended_validators: recommendedValidators,
      policy_actions: computed.policy_actions,
      score_breakdown: computed.score_breakdown,
      trace_id: traceId,
      engine_version: computed.engine_version,
      policy_version: computed.policy_version,
      expires_at: computed.expires_at,
      created_at: createdAt
    };
    this.db
      .prepare(
        "INSERT INTO trust_resolutions (resolution_id, subject_id, context_hash, score, band, confidence, decision, reason_codes, recommended_validators, policy_actions, score_breakdown, trace_id, engine_version, policy_version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        resolution.resolution_id,
        resolution.subject_id,
        resolution.context_hash,
        resolution.score,
        resolution.band,
        resolution.confidence,
        resolution.decision,
        JSON.stringify(resolution.reason_codes),
        JSON.stringify(resolution.recommended_validators),
        JSON.stringify(resolution.policy_actions),
        JSON.stringify(resolution.score_breakdown),
        resolution.trace_id,
        resolution.engine_version,
        resolution.policy_version,
        resolution.expires_at,
        resolution.created_at
      );

    const trace = {
      trace_id: traceId,
      subject_id: input.subject_id,
      resolution_id: resolutionId,
      routing_id: null,
      input_refs: {
        passport_id: passport.passport_id,
        snapshot_version: snapshot.snapshot_version,
        evidence_ids: evidences.map((entry) => entry.evidence_id),
        snapshot: {
          subject_id: snapshot.subject_id,
          snapshot_version: snapshot.snapshot_version,
          vector: snapshot.vector,
          aggregate_counts: snapshot.aggregate_counts,
          last_event_at: snapshot.last_event_at,
          updated_at: snapshot.updated_at
        }
      },
      context,
      scoring: {
        engine_version: resolution.engine_version,
        policy_version: resolution.policy_version,
        components: {
          ...resolution.score_breakdown,
          penalties: {
            dispute_penalty: resolution.score_breakdown.dispute_penalty,
            collusion_penalty: resolution.score_breakdown.collusion_penalty,
            decay_adjustment: resolution.score_breakdown.decay_adjustment
          }
        }
      },
      outputs: {
        score: resolution.score,
        band: resolution.band,
        decision: resolution.decision,
        confidence: resolution.confidence,
        recommended_validators: resolution.recommended_validators
      },
      created_at: createdAt
    };
    this.db
      .prepare(
        "INSERT INTO traces (trace_id, subject_id, resolution_id, routing_id, input_refs, context, scoring, outputs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        trace.trace_id,
        trace.subject_id,
        trace.resolution_id,
        null,
        JSON.stringify(trace.input_refs),
        JSON.stringify(trace.context),
        JSON.stringify(trace.scoring),
        JSON.stringify(trace.outputs),
        trace.created_at
      );

    this.emitEvent({
      type: "trust.resolved",
      subject: input.subject_id,
      traceId,
      data: {
        resolution_id: resolutionId,
        score: resolution.score,
        band: resolution.band,
        confidence: resolution.confidence,
        decision: resolution.decision,
        context
      },
      source: "infopunks.trust-engine"
    });
    if (
      context.risk_level === "high" &&
      resolution.confidence < policy.thresholds.minimum_confidence_high_risk
    ) {
      this.emitEvent({
        type: "trust.confidence_low",
        subject: input.subject_id,
        traceId,
        data: {
          resolution_id: resolutionId,
          confidence: resolution.confidence,
          minimum_required: policy.thresholds.minimum_confidence_high_risk,
          context,
          occurred_at: createdAt
        },
        source: "infopunks.trust-engine"
      });
    }
    if (resolution.decision === "allow_with_validation") {
      this.emitEvent({
        type: "validation.requested",
        subject: input.subject_id,
        traceId,
        data: {
          resolution_id: resolutionId,
          recommended_validators: recommendedValidators,
          policy_actions: resolution.policy_actions,
          context,
          occurred_at: createdAt
        },
        source: "infopunks.trust-engine"
      });
    }

    if (
      context.risk_level === "high" &&
      resolution.confidence < policy.thresholds.minimum_confidence_high_risk &&
      resolution.recommended_validators.length === 0
    ) {
      throw appError({
        code: "LOW_CONFIDENCE",
        message: "Trust resolution confidence below policy threshold.",
        statusCode: 409,
        details: {
          subject_id: input.subject_id,
          confidence: resolution.confidence,
          minimum_required: policy.thresholds.minimum_confidence_high_risk
        },
        suggestedActions: ["request_additional_validation", "expand_evidence_window", "escalate_to_operator"],
        traceId
      });
    }

    const trustEvent = computeTrustEvent(
      previousResolution,
      resolution,
      evidences[0]?.evidence_id ?? null,
      createdAt,
      context
    );
    if (trustEvent) {
      if (resolution.confidence < policy.thresholds.minimum_confidence_high_risk && context.risk_level === "high") {
        this.recordMetric("low_confidence_total", 1);
      }
      this.emitEvent({
        type: trustEvent.type,
        subject: input.subject_id,
        traceId,
        data: trustEvent.data,
        source: "infopunks.trust-engine"
      });
      if (resolution.band === "quarantined") {
        this.emitEvent({
          type: "quarantine.enforced",
          subject: input.subject_id,
          traceId,
          data: {
            score: resolution.score,
            reason_codes: resolution.reason_codes,
            policy_actions: resolution.policy_actions
          },
          source: "infopunks.trust-engine"
        });
      }
      if (["high", "critical"].includes(trustEvent.data.severity ?? "")) {
        this.emitEvent({
          type: "warroom.alerted",
          subject: input.subject_id,
          traceId,
          data: {
            alert_kind: trustEvent.type,
            severity: trustEvent.data.severity,
            recommended_actions: trustEvent.data.recommended_actions ?? []
          },
          source: "infopunks.trust-engine"
        });
      }
    }

    this.recordMetric("trust_resolve_total", 1);
    this.recordMetric("trust_resolve_duration_ms", Date.now() - started);
    return this.shapeResolutionResponse(resolution, input.response_mode ?? "standard");
  }

  shapeResolutionResponse(resolution, mode) {
    if (["minimal", "standard", "explain", "audit"].includes(mode)) {
      return resolution;
    }
    return resolution;
  }

  candidateBand(score) {
    if (score >= 90) return "privileged";
    if (score >= 75) return "preferred";
    if (score >= 60) return "allowed";
    if (score >= 40) return "watch";
    if (score >= 20) return "restricted";
    return "quarantined";
  }

  selectValidators(input) {
    const policy = this.getPolicy(input.policy_id, input.policy_version);
    this.ensureSubject(input.subject_id);
    const taskId = input.task_id ?? makeId("task");
    const traceId = makeId("trc");
    const createdAt = nowIso();
    const subjectSnapshot = this.getSnapshot(input.subject_id) ?? this.recomputeSnapshot(input.subject_id);
    const quorumPolicy = normalizeQuorumPolicy(input.quorum_policy, input.minimum_count ?? 1, policy);
    const selected = [];
    const rejected = [];

    for (const candidateId of input.candidates ?? []) {
      try {
        const passport = this.ensureSubject(candidateId);
        if (passport.subject_type !== "validator" && !passport.capabilities.some((entry) => entry.name === "validation")) {
          rejected.push({ subject_id: candidateId, why: ["not_validator_capable"] });
          continue;
        }
        const snapshot = this.getSnapshot(candidateId) ?? this.recomputeSnapshot(candidateId);
        const domainFit = Number(snapshot.vector.domain_competence?.[input.context?.domain] ?? 0.2);
        const resolution = computeResolution({
          passport,
          snapshot,
          context: input.context ?? {},
          policy,
          nowIso: nowIso()
        });
        const trustScore = resolution.score;
        const band = resolution.band;
        const sameCluster =
          Math.abs(
            Number(snapshot.vector.closed_cluster_density ?? 0) - Number(subjectSnapshot.vector.closed_cluster_density ?? 0)
          ) < 0.1 &&
          snapshot.vector.collusion_risk > 0.4;
        if (snapshot.vector.collusion_risk >= 0.55 || sameCluster) {
          rejected.push({
            subject_id: candidateId,
            why: ["shared_validation_cluster", "collusion_risk"]
          });
          continue;
        }
        if (!validationEligible(band, input.context, policy)) {
          rejected.push({
            subject_id: candidateId,
            why: ["trust_below_validation_threshold"]
          });
          continue;
        }

        const latencyScore = 1 - clamp(0, Number(snapshot.vector.execution_reliability ?? 0) * 0.2, 1);
        const selectionScore = round(
          clamp(0, 0.55 * (trustScore / 100) + 0.25 * domainFit + 0.1 * resolution.confidence + 0.1 * (1 - latencyScore), 1),
          2
        );
        const why = [];
        if (trustScore >= 75) {
          why.push("high_trust");
        } else {
          why.push("acceptable_trust");
        }
        if (domainFit >= 0.6) {
          why.push("high_domain_fit");
        } else {
          why.push("domain_fit_adequate");
        }
        why.push("independent_cluster");
        selected.push({
          subject_id: candidateId,
          selection_score: selectionScore,
          why
        });
      } catch (error) {
        rejected.push({
          subject_id: candidateId,
          why: [error.code === "UNKNOWN_SUBJECT" ? "unknown_subject" : "candidate_blocked"]
        });
      }
    }

    selected.sort((a, b) => b.selection_score - a.selection_score || a.subject_id.localeCompare(b.subject_id));
    const requiredCount = quorumPolicy.required_count;
    const finalSelected = selected.slice(0, requiredCount);
    const routeType = "validator_selection";
    const routingId = makeId("rte");
    const averageSelectionScore =
      finalSelected.length === 0 ? 0 : finalSelected.reduce((sum, entry) => sum + entry.selection_score, 0) / finalSelected.length;
    const quorumSatisfied =
      finalSelected.length >= requiredCount && averageSelectionScore >= quorumPolicy.consensus_threshold;
    const quorum = {
      mode: quorumPolicy.mode,
      required_count: requiredCount,
      selected_count: finalSelected.length,
      consensus_threshold: quorumPolicy.consensus_threshold,
      satisfied: quorumSatisfied,
      escalation_action: quorumSatisfied ? null : quorumPolicy.escalation_action
    };
    const rerouted =
      rejected.length > 0 ||
      (input.candidates?.[0] && finalSelected[0]?.subject_id !== input.candidates[0]);
    const rerouteReason = !rerouted
      ? null
      : finalSelected.length === 0
        ? "no_eligible_candidates"
        : rejected.some((entry) => entry.why.includes("collusion_risk"))
          ? "trust_filtered_candidates"
          : "preferred_candidate_unavailable";
    const policyActions = finalSelected.length === 0 ? ["require_manual_escalation"] : ["require_dual_validation"];
    if (!quorumSatisfied) {
      policyActions.push(...(policy.actions.quorum_unsatisfied ?? []));
      if (!policyActions.includes(quorumPolicy.escalation_action)) {
        policyActions.push(quorumPolicy.escalation_action);
      }
    }
    if (rerouted && !policyActions.includes("record_reroute_reason")) {
      policyActions.push("record_reroute_reason");
    }

    this.db
      .prepare(
        "INSERT INTO routing_decisions (routing_id, task_id, route_type, subject_id, selected, rejected, policy_actions, rerouted, reroute_reason, quorum, trace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        routingId,
        taskId,
        routeType,
        input.subject_id,
        JSON.stringify(finalSelected),
        JSON.stringify(rejected),
        JSON.stringify(policyActions),
        rerouted ? 1 : 0,
        rerouteReason,
        JSON.stringify(quorum),
        traceId,
        createdAt
      );

    const trace = {
      trace_id: traceId,
      subject_id: input.subject_id,
      resolution_id: null,
      routing_id: routingId,
      input_refs: {
        subject_snapshot_version: subjectSnapshot.snapshot_version,
        candidate_ids: input.candidates ?? [],
        subject_snapshot: {
          subject_id: subjectSnapshot.subject_id,
          snapshot_version: subjectSnapshot.snapshot_version,
          vector: subjectSnapshot.vector,
          aggregate_counts: subjectSnapshot.aggregate_counts,
          last_event_at: subjectSnapshot.last_event_at,
          updated_at: subjectSnapshot.updated_at
        }
      },
      context: input.context ?? {},
      scoring: {
        engine_version: "routing-engine@1.0.0",
        policy_version: `${policy.policy_id}@${policy.version}`
      },
      outputs: {
        selected: finalSelected,
        rejected,
        policy_actions: policyActions,
        rerouted: rerouted,
        reroute_reason: rerouteReason,
        quorum
      },
      created_at: createdAt
    };
    this.db
      .prepare(
        "INSERT INTO traces (trace_id, subject_id, resolution_id, routing_id, input_refs, context, scoring, outputs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        trace.trace_id,
        trace.subject_id,
        null,
        trace.routing_id,
        JSON.stringify(trace.input_refs),
        JSON.stringify(trace.context),
        JSON.stringify(trace.scoring),
        JSON.stringify(trace.outputs),
        trace.created_at
      );

    const eventType = finalSelected.length === 0 ? "route.blocked" : "route.selected";
    this.emitEvent({
      type: eventType,
      subject: input.subject_id,
      traceId,
      data: {
        task_id: taskId,
        selected: finalSelected,
        rejected,
        policy_actions: policyActions,
        rerouted,
        reroute_reason: rerouteReason,
        quorum
      },
      source: "infopunks.routing-service"
    });
    if (rerouted && finalSelected.length > 0) {
      this.emitEvent({
        type: "route.rerouted",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          reroute_reason: rerouteReason,
          selected: finalSelected
        },
        source: "infopunks.routing-service"
      });
    }
    if (rerouted) {
      this.emitEvent({
        type: "route.changed",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          reroute_reason: rerouteReason,
          selected: finalSelected,
          occurred_at: createdAt
        },
        source: "infopunks.routing-service"
      });
    }
    if (!quorumSatisfied) {
      this.emitEvent({
        type: "quorum.escalated",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          quorum,
          selected: finalSelected
        },
        source: "infopunks.routing-service"
      });
      this.emitEvent({
        type: "route.escalated",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          escalation_action: quorum.escalation_action,
          quorum,
          occurred_at: createdAt
        },
        source: "infopunks.routing-service"
      });
    }

    this.recordMetric("routing_decision_total", 1);
    return {
      routing_id: routingId,
      task_id: taskId,
      route_type: routeType,
      subject_id: input.subject_id,
      selected: finalSelected,
      rejected,
      policy_actions: policyActions,
      rerouted,
      reroute_reason: rerouteReason,
      quorum,
      trace_id: traceId,
      created_at: createdAt
    };
  }

  selectExecutors(input) {
    const policy = this.getPolicy(input.policy_id, input.policy_version);
    this.ensureSubject(input.subject_id);
    const taskId = input.task_id ?? makeId("task");
    const traceId = makeId("trc");
    const createdAt = nowIso();
    const selected = [];
    const degradedCandidates = [];
    const rejected = [];

    for (const candidateId of input.candidates ?? []) {
      try {
        const passport = this.ensureSubject(candidateId);
        const executorCapable =
          passport.capabilities.some((entry) => entry.name === "execution") ||
          ["agent", "operator_service", "tool_adapter"].includes(passport.subject_type);
        if (!executorCapable) {
          rejected.push({ subject_id: candidateId, why: ["not_executor_capable"] });
          continue;
        }
        const snapshot = this.getSnapshot(candidateId) ?? this.recomputeSnapshot(candidateId);
        const context = input.context ?? {};
        const resolution = computeResolution({
          passport,
          snapshot,
          context,
          policy,
          nowIso: nowIso()
        });
        const domainFit = Number(snapshot.vector.domain_competence?.[context.domain] ?? 0.2);
        const executionReliability = Number(snapshot.vector.execution_reliability ?? 0.5);
        const selectionScore = round(
          clamp(0, 0.45 * (resolution.score / 100) + 0.25 * executionReliability + 0.2 * domainFit + 0.1 * resolution.confidence, 1),
          2
        );
        const severeCollusion =
          snapshot.vector.collusion_risk >= Number(policy.thresholds.maximum_executor_collusion_risk ?? 0.55) &&
          (
            Number(snapshot.vector.shared_issuer_ratio ?? 0) > 0.25 ||
            Number(snapshot.vector.shared_infra_ratio ?? 0) > 0.25
          );
        if (severeCollusion) {
          rejected.push({ subject_id: candidateId, why: ["collusion_risk"] });
          continue;
        }
        if (resolution.decision === "deny" || resolution.decision === "restrict") {
          if (input.allow_autonomy_downgrade && resolution.band !== "quarantined") {
            degradedCandidates.push({
              subject_id: candidateId,
              selection_score: round(Math.max(0, selectionScore - 0.15), 2),
              why: ["downgraded_autonomy", "requires_validation_guardrail", "trust_below_execution_threshold"]
            });
            continue;
          }
          rejected.push({ subject_id: candidateId, why: ["trust_below_execution_threshold"] });
          continue;
        }
        const why = [];
        why.push(resolution.score >= 75 ? "high_trust" : "acceptable_trust");
        why.push(executionReliability >= 0.7 ? "strong_execution_reliability" : "execution_reliability_adequate");
        why.push(domainFit >= 0.6 ? "high_domain_fit" : "domain_fit_adequate");
        if (resolution.decision === "allow_with_validation") {
          why.push("requires_validation_guardrail");
        }
        selected.push({
          subject_id: candidateId,
          selection_score: selectionScore,
          why
        });
      } catch (error) {
        rejected.push({
          subject_id: candidateId,
          why: [error.code === "UNKNOWN_SUBJECT" ? "unknown_subject" : "candidate_blocked"]
        });
      }
    }

    selected.sort((a, b) => b.selection_score - a.selection_score || a.subject_id.localeCompare(b.subject_id));
    degradedCandidates.sort((a, b) => b.selection_score - a.selection_score || a.subject_id.localeCompare(b.subject_id));
    let finalSelected = selected.slice(0, Math.max(1, Number(input.minimum_count ?? 1)));
    const autonomyDowngraded = finalSelected.length === 0 && degradedCandidates.length > 0;
    if (autonomyDowngraded) {
      finalSelected = degradedCandidates.slice(0, 1);
    }
    const routeType = "executor_selection";
    const routingId = makeId("rte");
    const rerouted =
      rejected.length > 0 ||
      (input.candidates?.[0] && finalSelected[0]?.subject_id !== input.candidates[0]);
    const rerouteReason = !rerouted
      ? null
      : finalSelected.length === 0
        ? "no_eligible_executors"
        : rejected.some((entry) => entry.why.includes("collusion_risk"))
          ? "trust_filtered_candidates"
          : "preferred_executor_unavailable";
    const policyActions = finalSelected.length === 0 ? ["reroute_execution", "require_manual_escalation"] : [];
    if ((input.allow_autonomy_downgrade && finalSelected.length > 0) || autonomyDowngraded) {
      policyActions.push("downgrade_autonomy");
    }
    if (rerouted && !policyActions.includes("record_reroute_reason")) {
      policyActions.push("record_reroute_reason");
    }
    if (finalSelected.length > 0 && !policyActions.includes("require_validator_quorum")) {
      policyActions.push("require_validator_quorum");
    }

    this.db
      .prepare(
        "INSERT INTO routing_decisions (routing_id, task_id, route_type, subject_id, selected, rejected, policy_actions, rerouted, reroute_reason, quorum, trace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        routingId,
        taskId,
        routeType,
        input.subject_id,
        JSON.stringify(finalSelected),
        JSON.stringify(rejected),
        JSON.stringify(policyActions),
        rerouted ? 1 : 0,
        rerouteReason,
        JSON.stringify(null),
        traceId,
        createdAt
      );

    const trace = {
      trace_id: traceId,
      subject_id: input.subject_id,
      resolution_id: null,
      routing_id: routingId,
      input_refs: {
        candidate_ids: input.candidates ?? []
      },
      context: input.context ?? {},
      scoring: {
        engine_version: "routing-engine@1.0.0",
        policy_version: `${policy.policy_id}@${policy.version}`
      },
      outputs: {
        selected: finalSelected,
        rejected,
        policy_actions: policyActions,
        rerouted,
        reroute_reason: rerouteReason,
        quorum: null
      },
      created_at: createdAt
    };
    this.db
      .prepare(
        "INSERT INTO traces (trace_id, subject_id, resolution_id, routing_id, input_refs, context, scoring, outputs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        trace.trace_id,
        trace.subject_id,
        null,
        trace.routing_id,
        JSON.stringify(trace.input_refs),
        JSON.stringify(trace.context),
        JSON.stringify(trace.scoring),
        JSON.stringify(trace.outputs),
        trace.created_at
      );

    this.emitEvent({
      type: finalSelected.length === 0 ? "executor.blocked" : "executor.selected",
      subject: input.subject_id,
      traceId,
      data: {
        task_id: taskId,
        selected: finalSelected,
        rejected,
        policy_actions: policyActions,
        rerouted,
        reroute_reason: rerouteReason
      },
      source: "infopunks.routing-service"
    });
    if (finalSelected.length > 0) {
      this.emitEvent({
        type: "validation.requested",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          selected: finalSelected,
          policy_actions: policyActions,
          occurred_at: createdAt
        },
        source: "infopunks.routing-service"
      });
    }
    if (rerouted && finalSelected.length > 0) {
      this.emitEvent({
        type: "route.rerouted",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          reroute_reason: rerouteReason,
          selected: finalSelected
        },
        source: "infopunks.routing-service"
      });
      this.emitEvent({
        type: "route.changed",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          reroute_reason: rerouteReason,
          selected: finalSelected,
          occurred_at: createdAt
        },
        source: "infopunks.routing-service"
      });
    }
    if (policyActions.includes("downgrade_autonomy") || finalSelected.length === 0) {
      this.emitEvent({
        type: "route.escalated",
        subject: input.subject_id,
        traceId,
        data: {
          task_id: taskId,
          route_type: routeType,
          escalation_action: finalSelected.length === 0 ? "manual_review" : "reroute_execution",
          policy_actions: policyActions,
          occurred_at: createdAt
        },
        source: "infopunks.routing-service"
      });
    }

    this.recordMetric("routing_decision_total", 1);
    return {
      routing_id: routingId,
      task_id: taskId,
      route_type: routeType,
      subject_id: input.subject_id,
      selected: finalSelected,
      rejected,
      policy_actions: policyActions,
      rerouted,
      reroute_reason: rerouteReason,
      quorum: null,
      trace_id: traceId,
      created_at: createdAt
    };
  }

  getTrace(traceId) {
    const row = this.db.prepare("SELECT * FROM traces WHERE trace_id = ?").get(traceId);
    if (!row) {
      throw appError({
        code: "TRACE_UNAVAILABLE",
        message: `Trace unavailable: ${traceId}`,
        statusCode: 404,
        details: { trace_id: traceId },
        suggestedActions: ["check_trace_id"]
      });
    }
    const trace = {
      trace_id: row.trace_id,
      subject_id: row.subject_id,
      resolution_id: row.resolution_id,
      routing_id: row.routing_id,
      input_refs: parseJsonColumn(row.input_refs, {}),
      context: parseJsonColumn(row.context, {}),
      scoring: parseJsonColumn(row.scoring, {}),
      outputs: parseJsonColumn(row.outputs, {}),
      created_at: row.created_at
    };
    const passport = this.getPassport(trace.subject_id);
    const snapshot = this.getSnapshot(trace.subject_id);
    const tracedSnapshot = trace.input_refs.snapshot ?? null;
    const evidenceIds = trace.input_refs.evidence_ids ?? [];
    const evidence = evidenceIds
      .map((evidenceId) => {
        const evidenceRow = this.db.prepare("SELECT * FROM evidence_records WHERE evidence_id = ?").get(evidenceId);
        return evidenceRow ? toEvidence(evidenceRow, this.db) : null;
      })
      .filter(Boolean);
    let replay = null;
    if (trace.resolution_id) {
      const policyVersion = String(trace.scoring.policy_version ?? `${DEFAULT_POLICY.policy_id}@${DEFAULT_POLICY.version}`);
      const [policyId, version] = policyVersion.split("@");
      const policy = this.getPolicy(policyId, version);
      const resolution = toResolution(this.db.prepare("SELECT * FROM trust_resolutions WHERE resolution_id = ?").get(trace.resolution_id));
      if (passport && (tracedSnapshot ?? snapshot) && resolution) {
        const recomputed = computeResolution({
          passport,
          snapshot: tracedSnapshot ?? snapshot,
          context: trace.context,
          policy,
          nowIso: resolution.created_at
        });
        replay = {
          matches: recomputed.score === resolution.score && recomputed.band === resolution.band && recomputed.decision === resolution.decision,
          recomputed: {
            score: recomputed.score,
            band: recomputed.band,
            decision: recomputed.decision,
            confidence: recomputed.confidence
          }
        };
      }
    }

    this.emitEvent({
      type: "task.replayed",
      subject: trace.subject_id,
      traceId,
      data: {
        trace_id: traceId,
        resolution_id: trace.resolution_id,
        routing_id: trace.routing_id,
        occurred_at: nowIso()
      },
      source: "infopunks.trace-service"
    });
    const relatedAlert = this.db
      .prepare("SELECT payload FROM trust_events WHERE trace_id = ? AND type IN ('warroom.alerted', 'warroom.alert.raised') ORDER BY seq DESC LIMIT 1")
      .get(traceId);
    if (relatedAlert) {
      const alert = JSON.parse(relatedAlert.payload);
      this.emitEvent({
        type: "warroom.alert.acknowledged",
        subject: trace.subject_id,
        traceId,
        data: {
          acknowledged_event_id: alert.event_id ?? alert.id,
          alert_kind: alert.event_type ?? alert.type,
          occurred_at: nowIso()
        },
        source: "infopunks.trace-service"
      });
    }

    return shapeTraceReplayBundle({
      trace,
      passport,
      snapshot: tracedSnapshot ?? snapshot,
      evidence,
      resolution: trace.resolution_id
        ? toResolution(this.db.prepare("SELECT * FROM trust_resolutions WHERE resolution_id = ?").get(trace.resolution_id))
        : null,
      routing: trace.routing_id
        ? toRouting(this.db.prepare("SELECT * FROM routing_decisions WHERE routing_id = ?").get(trace.routing_id))
        : null,
      replay
    });
  }

  explainTrust(subjectId, query = {}) {
    this.ensureSubject(subjectId);
    const row = query.context_hash
      ? this.db
          .prepare("SELECT * FROM trust_resolutions WHERE subject_id = ? AND context_hash = ? ORDER BY created_at DESC LIMIT 1")
          .get(subjectId, query.context_hash)
      : this.db
          .prepare("SELECT * FROM trust_resolutions WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1")
          .get(subjectId);
    const resolution = toResolution(row);
    if (!resolution) {
      throw appError({
        code: "TRACE_UNAVAILABLE",
        message: "Trust explanation unavailable.",
        statusCode: 404,
        details: { subject_id: subjectId, context_hash: query.context_hash ?? null },
        suggestedActions: ["resolve_trust_first"]
      });
    }
    const snapshot = this.getSnapshot(subjectId);
    const recentEvents = this.db
      .prepare("SELECT payload FROM trust_events WHERE subject_id = ? ORDER BY seq DESC LIMIT 5")
      .all(subjectId)
      .map((entry) => JSON.parse(entry.payload));
    return shapeTrustExplanation({
      subjectId,
      resolution,
      snapshot,
      recentEvents
    });
  }

  getPrometheusMetrics() {
    const avg = (values) =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    const metricLines = [
      "# TYPE infopunks_http_requests_total counter",
      `infopunks_http_requests_total ${this.metrics.http_requests_total}`,
      "# TYPE infopunks_http_request_duration_ms gauge",
      `infopunks_http_request_duration_ms ${round(avg(this.metrics.http_request_duration_ms), 2)}`,
      "# TYPE infopunks_evidence_ingest_total counter",
      `infopunks_evidence_ingest_total ${this.metrics.evidence_ingest_total}`,
      "# TYPE infopunks_snapshot_update_duration_ms gauge",
      `infopunks_snapshot_update_duration_ms ${round(avg(this.metrics.snapshot_update_duration_ms), 2)}`,
      "# TYPE infopunks_trust_resolve_total counter",
      `infopunks_trust_resolve_total ${this.metrics.trust_resolve_total}`,
      "# TYPE infopunks_trust_resolve_duration_ms gauge",
      `infopunks_trust_resolve_duration_ms ${round(avg(this.metrics.trust_resolve_duration_ms), 2)}`,
      "# TYPE infopunks_routing_decision_total counter",
      `infopunks_routing_decision_total ${this.metrics.routing_decision_total}`,
      "# TYPE infopunks_event_emit_total counter",
      `infopunks_event_emit_total ${this.metrics.event_emit_total}`,
      "# TYPE infopunks_event_lag_ms gauge",
      `infopunks_event_lag_ms ${round(avg(this.metrics.event_lag_ms), 2)}`,
      "# TYPE infopunks_low_confidence_total counter",
      `infopunks_low_confidence_total ${this.metrics.low_confidence_total}`,
      "# TYPE infopunks_collusion_alert_total counter",
      `infopunks_collusion_alert_total ${this.metrics.collusion_alert_total}`
    ];

    for (const [statusCode, count] of this.metrics.http_status_counts.entries()) {
      metricLines.push(
        `infopunks_http_requests_by_status_total{status_code="${statusCode}"} ${count}`
      );
    }
    for (const [errorCode, count] of this.metrics.http_error_code_counts.entries()) {
      metricLines.push(
        `infopunks_http_errors_total{error_code="${errorCode}"} ${count}`
      );
    }
    for (const [routeId, metric] of this.metrics.http_route_timings.entries()) {
      const average = metric.count === 0 ? 0 : metric.totalMs / metric.count;
      metricLines.push(
        `infopunks_http_route_duration_ms{route_id="${routeId}"} ${round(average, 2)}`
      );
    }
    for (const [eventType, count] of this.metrics.event_type_counts.entries()) {
      metricLines.push(
        `infopunks_events_total{event_type="${eventType}"} ${count}`
      );
    }
    return metricLines.join("\n");
  }

  emitEvent({ type, subject, traceId, data, source, dispatchWebhooks = true }) {
    const event = makeCloudEvent({
      id: makeId("tev"),
      type,
      source,
      subject,
      trace_id: traceId,
      data,
      time: nowIso()
    });
    this.db
      .prepare(
        "INSERT INTO trust_events (event_id, type, subject_id, trace_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(event.id, type, subject, traceId, JSON.stringify(event), event.time);
    this.recordMetric("event_emit_total", 1);
    this.metrics.event_type_counts.set(type, (this.metrics.event_type_counts.get(type) ?? 0) + 1);
    const occurredAt = data?.occurred_at ?? data?.created_at ?? event.time;
    const lagMs = Math.max(0, new Date(event.time).getTime() - new Date(occurredAt).getTime());
    this.recordMetric("event_lag_ms", lagMs);
    for (const stream of this.streams) {
      if (stream.matches(event)) {
        stream.send(event);
      }
    }
    if (dispatchWebhooks) {
      this.dispatchWebhooks(event);
    }
    const aliasType =
      type === "passport.key_rotated"
        ? "passport.rotated"
        : type === "warroom.alerted"
            ? "warroom.alert.raised"
            : null;
    if (aliasType) {
      const aliasEvent = makeCloudEvent({
        id: makeId("tev"),
        type: aliasType,
        source,
        subject,
        trace_id: traceId,
        data,
        time: nowIso()
      });
      this.db
        .prepare(
          "INSERT INTO trust_events (event_id, type, subject_id, trace_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(aliasEvent.id, aliasType, subject, traceId, JSON.stringify(aliasEvent), aliasEvent.time);
      this.recordMetric("event_emit_total", 1);
      this.metrics.event_type_counts.set(aliasType, (this.metrics.event_type_counts.get(aliasType) ?? 0) + 1);
      const aliasLagMs = Math.max(0, new Date(aliasEvent.time).getTime() - new Date(occurredAt).getTime());
      this.recordMetric("event_lag_ms", aliasLagMs);
      for (const stream of this.streams) {
        if (stream.matches(aliasEvent)) {
          stream.send(aliasEvent);
        }
      }
      if (dispatchWebhooks) {
        this.dispatchWebhooks(aliasEvent);
      }
    }
    return event;
  }

  addStream(stream) {
    this.streams.add(stream);
    return () => {
      this.streams.delete(stream);
    };
  }

  getEvents({ since, limit = 100 } = {}) {
    const rows = since
      ? this.db
          .prepare("SELECT payload FROM trust_events WHERE seq > ? ORDER BY seq ASC LIMIT ?")
          .all(Number(since), limit)
      : this.db
          .prepare("SELECT payload FROM trust_events ORDER BY seq DESC LIMIT ?")
          .all(limit)
          .reverse();
    return rows.map((entry) => JSON.parse(entry.payload));
  }

  eventMatchesFilter(event, filters = {}) {
    const types = filters.types ? filters.types.split(",").filter(Boolean) : [];
    const subjects = filters.subjects ? filters.subjects.split(",").filter(Boolean) : [];
    const typeMatch = types.length === 0 || types.includes(event.type) || types.includes(event.event_type);
    const subjectMatch = subjects.length === 0 || subjects.includes(event.subject) || subjects.includes(event.subject_id);
    return typeMatch && subjectMatch;
  }

  getWarRoomState() {
    const events = this.getEvents({ limit: 100 }).reverse();
    const latestResolutions = this.db
      .prepare("SELECT * FROM trust_resolutions ORDER BY created_at DESC")
      .all()
      .map((row) => toResolution(row));
    const bySubject = new Map();
    for (const resolution of latestResolutions) {
      const list = bySubject.get(resolution.subject_id) ?? [];
      if (list.length < 2) {
        list.push(resolution);
        bySubject.set(resolution.subject_id, list);
      }
    }
    const movers = [...bySubject.entries()]
      .map(([subjectId, resolutions]) => ({
        subject_id: subjectId,
        current_score: resolutions[0]?.score ?? 0,
        delta: (resolutions[0]?.score ?? 0) - (resolutions[1]?.score ?? resolutions[0]?.score ?? 0),
        band: resolutions[0]?.band ?? "quarantined"
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.current_score - a.current_score)
      .slice(0, 10);

    const quarantines = latestResolutions.filter((entry) => entry.band === "quarantined").slice(0, 10);
    const routing = this.db
      .prepare("SELECT * FROM routing_decisions ORDER BY created_at DESC LIMIT 20")
      .all()
      .map((row) => toRouting(row));
    const clusterMap = this.db
      .prepare("SELECT subject_id, vector FROM trust_snapshots ORDER BY updated_at DESC LIMIT 20")
      .all()
      .map((row) => ({
        subject_id: row.subject_id,
        collusion_risk: parseJsonColumn(row.vector, {}).collusion_risk ?? 0,
        closed_cluster_density: parseJsonColumn(row.vector, {}).closed_cluster_density ?? 0,
        validator_diversity_score: parseJsonColumn(row.vector, {}).validator_diversity_score ?? 0
      }))
      .sort((a, b) => b.collusion_risk - a.collusion_risk);
    const recentAlerts = events.filter((event) => String(event.event_type ?? event.type).startsWith("warroom.alert")).slice(0, 10);
    const recentTraceReplays = events.filter((event) => (event.event_type ?? event.type) === "task.replayed").slice(0, 10);
    const lastTraceReplayAt = recentTraceReplays[0]?.created_at ?? recentTraceReplays[0]?.time ?? null;
    return shapeWarRoomState({
      generated_at: nowIso(),
      live_trust_event_feed: events.slice(0, 20),
      top_score_movers: movers,
      current_quarantines: quarantines,
      validator_routing_stream: routing,
      trust_graph_cluster_map: clusterMap,
      recent_alerts: recentAlerts,
      recent_trace_replays: recentTraceReplays,
      observability: {
        average_event_lag_ms:
          this.metrics.event_lag_ms.length === 0
            ? 0
            : round(this.metrics.event_lag_ms.reduce((sum, value) => sum + value, 0) / this.metrics.event_lag_ms.length, 2),
        last_trace_replay_at: lastTraceReplayAt,
        active_alerts: recentAlerts.filter((event) => (event.event_type ?? event.type) === "warroom.alert.raised").length
      }
    });
  }

  async runScenario(input = {}) {
    const subjectIds = [];
    const validatorIds = [];
    const domains = input.domain_mix ?? ["crypto", "macro", "infra"];
    const agentCount = input.number_of_agents ?? 10;
    const validatorCount = input.number_of_validators ?? 3;
    for (let index = 1; index <= agentCount; index += 1) {
      const subjectId = `agent_${String(index).padStart(3, "0")}`;
      subjectIds.push(subjectId);
      if (!this.getPassport(subjectId)) {
        this.createPassport(
          {
            subject_id: subjectId,
            subject_type: "agent",
            did: `did:key:${subjectId}`,
            public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: `base58:${subjectId}` }],
            capabilities: [{ name: "research", version: "1.0", verified: true }],
            metadata: { framework: "openai-agents-sdk", owner_org: "simulator" }
          },
          `passport-${subjectId}`
        );
      }
    }
    for (let index = 1; index <= validatorCount; index += 1) {
      const subjectId = `validator_${String(index).padStart(3, "0")}`;
      validatorIds.push(subjectId);
      if (!this.getPassport(subjectId)) {
        this.createPassport(
          {
            subject_id: subjectId,
            subject_type: "validator",
            did: `did:key:${subjectId}`,
            public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: `base58:${subjectId}` }],
            capabilities: [{ name: "validation", version: "1.0", verified: true }],
            metadata: { framework: "openai-agents-sdk", owner_org: "simulator" }
          },
          `passport-${subjectId}`
        );
      }
    }

    for (const validatorId of validatorIds) {
      const existingEvidence = this.listEvidence(validatorId);
      if (existingEvidence.length === 0) {
        for (let step = 0; step < 3; step += 1) {
          this.recordEvidence(
            {
              subject_id: validatorId,
              event_type: "task.completed",
              task_id: `${validatorId}_baseline_${step}`,
              context: {
                task_type: "validator_bootstrap",
                domain: domains[step % domains.length],
                risk_level: "medium"
              },
              outcome: {
                status: "success",
                latency_ms: 900 + step * 120,
                cost_usd: 0.01,
                quality_score: 0.92,
                confidence_score: 0.88
              },
              validators: [],
              provenance: {
                source_system: "war_room_sim"
              }
            },
            `bootstrap-${validatorId}-${step}`
          );
        }
      }
    }

    const collusionCluster = ["validator_001", "validator_002"];
    const outputs = [];
    const stepCount = Math.max(18, agentCount + validatorCount + 5);
    for (let step = 0; step < stepCount; step += 1) {
      const subjectId = subjectIds[step % subjectIds.length];
      const domain = domains[step % domains.length];
      const validators =
        step < 6
          ? collusionCluster.map((validatorId) => ({
              validator_id: validatorId,
              verdict: "pass",
              weight: 0.92,
              reason_codes: ["evidence_sufficient", "internally_consistent"]
            }))
          : [
              {
                validator_id: validatorIds[step % validatorIds.length],
                verdict: step % 5 === 0 ? "fail" : "pass",
                weight: 0.88,
                reason_codes: ["evidence_sufficient"]
              },
              {
                validator_id: validatorIds[(step + 1) % validatorIds.length],
                verdict: "pass",
                weight: 0.83,
                reason_codes: ["independent_cluster"]
              }
            ];
      const eventType =
        step === 9 ? "validation.reversed" : step % 7 === 0 ? "task.failed" : "task.completed";
      const evidence = this.recordEvidence(
        {
          subject_id: subjectId,
          event_type: eventType,
          task_id: `task_${step + 1}`,
          context: {
            task_type: step % 2 === 0 ? "market_analysis" : "routing_review",
            domain,
            risk_level: step >= 8 ? "high" : "medium"
          },
          outcome: {
            status: eventType === "task.completed" ? "success" : eventType === "validation.reversed" ? "reversed" : "failed",
            latency_ms: 1200 + step * 90,
            cost_usd: round(0.02 + step * 0.004, 3),
            quality_score: step === 9 ? 0.2 : round(clamp(0, 0.92 - step * 0.03, 1), 2),
            confidence_score: step === 9 ? 0.18 : round(clamp(0, 0.86 - step * 0.025, 1), 2)
          },
          validators,
          provenance: {
            source_system: "war_room_sim"
          }
        },
        `evidence-${step}`
      );
      const resolution = this.resolveTrust({
        subject_id: subjectId,
        context: {
          task_type: "market_analysis",
          domain,
          risk_level: step >= 8 ? "high" : "medium"
        },
        response_mode: "standard"
      });
      const routing = this.selectValidators({
        task_id: `task_${step + 1}`,
        subject_id: subjectId,
        candidates: validatorIds,
        context: {
          task_type: "market_analysis",
          domain,
          risk_level: step >= 8 ? "high" : "medium"
        },
        minimum_count: 2
      });
      outputs.push({ evidence, resolution, routing });
    }

    return {
      ok: true,
      agents: subjectIds.length,
      validators: validatorIds.length,
      steps: outputs.length,
      last_resolution: outputs.at(-1)?.resolution ?? null,
      war_room_state: this.getWarRoomState()
    };
  }

  getPrompt(name) {
    const prompt = getPrompt(name);
    if (!prompt) {
      throw notFoundError({ prompt_name: name });
    }
    return prompt;
  }
}
