import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Infopunks } from "../packages/trust-sdk/index.mjs";

const API_KEY = "test-infopunks-key";
const READ_ONLY_API_KEY = "test-infopunks-read-only";
const WRONG_ENV_API_KEY = "test-infopunks-wrong-env";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiEntry = path.join(repoRoot, "apps", "api", "server.mjs");
const openApiPath = path.join(repoRoot, "openapi.yaml");
let nextPort = 4300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl) {
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await sleep(100);
  }
  throw new Error("Server did not become healthy in time.");
}

async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      return value;
    }
    await sleep(50);
  }
  throw new Error("Timed out waiting for condition.");
}

async function startServer(t, options = {}) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "infopunks-v1-"));
  const port = nextPort++;
  const dbPath = path.join(tempDir, "trust.db");
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiKeys = options.apiKeys ?? [
    {
      token: API_KEY,
      key_id: "key_test_root",
      caller_id: "test-root",
      scopes: ["read", "write"],
      environment: "local"
    }
  ];

  const server = spawn(process.execPath, [apiEntry], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      INFOPUNKS_API_KEY: API_KEY,
      INFOPUNKS_DB_PATH: dbPath,
      INFOPUNKS_ENVIRONMENT: options.environment ?? "local",
      INFOPUNKS_API_KEYS_JSON: JSON.stringify(apiKeys),
      ...(options.rateLimits
        ? { INFOPUNKS_RATE_LIMITS_JSON: JSON.stringify(options.rateLimits) }
        : {}),
      ...(options.sseMaxStreamsPerKey ? { INFOPUNKS_SSE_MAX_STREAMS_PER_KEY: String(options.sseMaxStreamsPerKey) } : {}),
      ...(options.webhookRetryBaseMs ? { INFOPUNKS_WEBHOOK_RETRY_BASE_MS: String(options.webhookRetryBaseMs) } : {})
    },
    stdio: "ignore"
  });

  t.after(() => {
    server.kill("SIGINT");
    rmSync(tempDir, { recursive: true, force: true });
  });

  await waitForHealth(baseUrl);

  async function api(pathname, { method = "GET", body, headers = {}, apiKey = API_KEY } = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: response.status, payload };
  }

  function openDb() {
    return new DatabaseSync(dbPath);
  }

  return {
    baseUrl,
    tempDir,
    dbPath,
    api,
    openDb,
    sdk: new Infopunks({
      apiKey: API_KEY,
      environment: "local",
      baseUrl,
      timeoutMs: 3000
    })
  };
}

test("boots cleanly from a non-repo working directory", async (t) => {
  const externalCwd = mkdtempSync(path.join(os.tmpdir(), "infopunks-external-cwd-"));
  t.after(() => rmSync(externalCwd, { recursive: true, force: true }));

  const { api, baseUrl } = await startServer(t, { cwd: externalCwd });
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);

  const metrics = await api("/metrics");
  assert.equal(metrics.status, 200);
  assert.match(metrics.payload, /infopunks_http_requests_total/);
});

async function readSseEvent(response, eventType, timeoutMs = 2500) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = "";

  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      sleep(100).then(() => ({ timeout: true }))
    ]);
    if (chunk?.timeout) {
      continue;
    }
    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      const name = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (name === eventType && dataLine) {
        return JSON.parse(dataLine.slice(6));
      }
    }
  }
  throw new Error(`Timed out waiting for ${eventType}`);
}

async function registerPassport(api, passport, key = passport.subject_id) {
  const response = await api("/v1/passports", {
    method: "POST",
    headers: {
      "Idempotency-Key": `passport-${key}`
    },
    body: passport
  });
  assert.equal(response.status, 201);
  return response.payload;
}

async function registerStandardSubjects(api) {
  await registerPassport(api, {
    subject_id: "agent_primary",
    subject_type: "agent",
    did: "did:key:agent_primary",
    public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_primary" }],
    capabilities: [{ name: "research", version: "1.0", verified: true }],
    metadata: { owner_org: "tests", framework: "openai-agents-sdk" }
  });

  for (const validatorId of ["validator_good_1", "validator_good_2", "validator_risky"]) {
    await registerPassport(api, {
      subject_id: validatorId,
      subject_type: "validator",
      did: `did:key:${validatorId}`,
      public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: `base58:${validatorId}` }],
      capabilities: [{ name: "validation", version: "1.0", verified: true }],
      metadata: { owner_org: "tests" }
    });
  }
}

async function seedValidator(api, subjectId, keyPrefix = subjectId) {
  for (let index = 0; index < 3; index += 1) {
    const response = await api("/v1/evidence", {
      method: "POST",
      headers: {
        "Idempotency-Key": `${keyPrefix}-${index}`
      },
      body: {
        subject_id: subjectId,
        event_type: "task.completed",
        task_id: `${subjectId}-task-${index}`,
        context: {
          task_type: "validator_bootstrap",
          domain: "crypto",
          risk_level: "medium"
        },
        outcome: {
          status: "success",
          latency_ms: 900 + index * 100,
          cost_usd: 0.01,
          quality_score: 0.94,
          confidence_score: 0.9
        },
        validators: [],
        provenance: {
          source_system: "tests"
        }
      }
    });
    assert.equal(response.status, 202);
  }
}

test("returns UNAUTHORIZED for missing or invalid auth", async (t) => {
  const { baseUrl } = await startServer(t);
  const response = await fetch(`${baseUrl}/v1/war-room/state`);
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "UNAUTHORIZED");
});

test("enforces API key scopes and environment binding", async (t) => {
  const { api } = await startServer(t, {
    apiKeys: [
      {
        token: API_KEY,
        key_id: "key_test_root",
        caller_id: "test-root",
        scopes: ["read", "write"],
        environment: "local"
      },
      {
        token: READ_ONLY_API_KEY,
        key_id: "key_test_read",
        caller_id: "test-reader",
        scopes: ["read"],
        environment: "local"
      },
      {
        token: WRONG_ENV_API_KEY,
        key_id: "key_test_prod",
        caller_id: "test-prod",
        scopes: ["read", "write"],
        environment: "prod"
      }
    ]
  });

  const readAllowed = await api("/v1/prompts/validator-routing", {
    apiKey: READ_ONLY_API_KEY
  });
  assert.equal(readAllowed.status, 200);

  const writeBlocked = await api("/v1/passports", {
    method: "POST",
    apiKey: READ_ONLY_API_KEY,
    body: {
      subject_id: "agent_scope_blocked",
      subject_type: "agent",
      did: "did:key:agent_scope_blocked",
      public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_scope_blocked" }],
      capabilities: [{ name: "research", version: "1.0", verified: true }],
      metadata: { owner_org: "tests" }
    }
  });
  assert.equal(writeBlocked.status, 403);
  assert.equal(writeBlocked.payload.error.code, "FORBIDDEN");
  assert.equal(writeBlocked.payload.error.details.required_scope, "write");

  const envBlocked = await api("/v1/war-room/state", {
    apiKey: WRONG_ENV_API_KEY
  });
  assert.equal(envBlocked.status, 403);
  assert.equal(envBlocked.payload.error.code, "FORBIDDEN");
  assert.equal(envBlocked.payload.error.details.expected_environment, "local");
});

test("validates request payloads for all write endpoints", async (t) => {
  const { api } = await startServer(t);
  const cases = [
    ["/v1/passports", {}],
    ["/v1/evidence", { subject_id: "agent_1" }],
    ["/v1/disputes/evaluate", { subject_id: "agent_1" }],
    ["/v1/trust/resolve", { subject_id: 123 }],
    ["/v1/routing/select-validator", { subject_id: "agent_1", candidates: "bad" }],
    ["/v1/sim/run", { number_of_agents: -1 }]
  ];
  for (const [pathname, body] of cases) {
    const response = await api(pathname, { method: "POST", body });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, "INVALID_REQUEST");
    assert.ok(Array.isArray(response.payload.error.details.issues));
  }
});

test("handles revoked and suspended passports consistently", async (t) => {
  const { api, openDb } = await startServer(t);
  await registerPassport(api, {
    subject_id: "agent_revoked",
    subject_type: "agent",
    did: "did:key:agent_revoked",
    public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_revoked" }],
    capabilities: [{ name: "research", version: "1.0", verified: true }],
    metadata: { owner_org: "tests" }
  });

  const revokeEvidence = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "revoke-agent" },
    body: {
      subject_id: "agent_revoked",
      event_type: "passport.revoked",
      context: { task_type: "passport_admin", domain: "routing", risk_level: "low" },
      outcome: { status: "revoked" },
      validators: [],
      disputes: [],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(revokeEvidence.status, 202);

  const revokedResolve = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_revoked",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
    }
  });
  assert.equal(revokedResolve.status, 409);
  assert.equal(revokedResolve.payload.error.code, "PASSPORT_REVOKED");

  await registerPassport(api, {
    subject_id: "agent_suspended",
    subject_type: "agent",
    did: "did:key:agent_suspended",
    public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_suspended" }],
    capabilities: [{ name: "research", version: "1.0", verified: true }],
    metadata: { owner_org: "tests" }
  });
  const db = openDb();
  db.prepare("UPDATE passports SET status = 'suspended' WHERE subject_id = ?").run("agent_suspended");

  const suspendedResolve = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_suspended",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
    }
  });
  assert.equal(suspendedResolve.status, 409);
  assert.equal(suspendedResolve.payload.error.code, "PASSPORT_SUSPENDED");
});

test("returns LOW_CONFIDENCE when high-risk trust cannot be resolved safely", async (t) => {
  const { api } = await startServer(t);
  await registerPassport(api, {
    subject_id: "agent_sparse",
    subject_type: "agent",
    did: "did:key:agent_sparse",
    public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_sparse" }],
    capabilities: [{ name: "research", version: "1.0", verified: true }],
    metadata: { owner_org: "tests" }
  });

  const response = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_sparse",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
    }
  });
  assert.equal(response.status, 409);
  assert.equal(response.payload.error.code, "LOW_CONFIDENCE");
});

test("returns prompt pack objects with stable shape", async (t) => {
  const { api } = await startServer(t);
  const response = await api("/v1/prompts/validator-routing");
  assert.equal(response.status, 200);
  assert.equal(response.payload.resource_type, "prompt_pack");
  assert.equal(response.payload.name, "validator-routing");
  assert.equal(typeof response.payload.content, "string");
  assert.equal(response.payload.intended_stage, "post_generation");
  assert.ok(Array.isArray(response.payload.expected_inputs));
  assert.ok(Array.isArray(response.payload.recommended_api_calls));
  assert.equal(typeof response.payload.variants.minimal, "string");
  assert.equal(typeof response.payload.variants.strict, "string");

  const capitalSafe = await api("/v1/prompts/capital-safe-execution");
  assert.equal(capitalSafe.status, 200);
  assert.equal(capitalSafe.payload.name, "capital-safe-execution");
  assert.equal(typeof capitalSafe.payload.variants.frameworks["openai-agents-sdk"], "string");
});

test("supports passport key rotation and exposes portability semantics", async (t) => {
  const { api, sdk } = await startServer(t);
  await registerPassport(api, {
    subject_id: "agent_portable",
    subject_type: "agent",
    did: "did:key:agent_portable",
    public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_portable" }],
    capabilities: [{ name: "execution", version: "1.0", verified: true }],
    issuer: {
      issuer_id: "org_portable",
      signature: "ed25519:portable",
      provenance: {
        trust_anchor: "portable-anchor",
        verification_method: "issuer_signature",
        issued_at: "2026-04-17T08:00:00Z"
      }
    },
    reputation_scope_defaults: { domains: ["crypto", "routing"], risk_tolerance: "medium" },
    metadata: { owner_org: "portable-lab" }
  });

  const passport = await api("/v1/passports/agent_portable");
  assert.equal(passport.status, 200);
  assert.equal(passport.payload.portability.portable_format, "passport_bundle@v1");
  assert.equal(passport.payload.issuer.provenance.trust_anchor, "portable-anchor");
  assert.equal(passport.payload.lifecycle.key_count, 1);

  const rotated = await sdk.passports.rotateKey("agent_portable", {
    key: { kid: "key_rotated", alg: "EdDSA", publicKey: "base58:agent_portable_rotated" },
    reason: "routine_rotation"
  });
  assert.equal(rotated.lifecycle.key_count, 2);
  assert.equal(rotated.lifecycle.status, "active");
  assert.equal(typeof rotated.lifecycle.last_key_rotation_at, "string");
});

test("returns trace replay bundles with stable shape", async (t) => {
  const { api } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");
  await seedValidator(api, "validator_good_2");

  const evidence = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "trace-evidence" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-trace-1",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      outcome: { status: "success", latency_ms: 1000, cost_usd: 0.02, quality_score: 0.91, confidence_score: 0.82 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.9, reason_codes: ["evidence_sufficient"] }
      ],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(evidence.status, 202);

  const resolution = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      candidate_validators: ["validator_good_1", "validator_good_2"]
    }
  });
  assert.equal(resolution.status, 200);

  const trace = await api(`/v1/traces/${resolution.payload.trace_id}`);
  assert.equal(trace.status, 200);
  assert.equal(trace.payload.resource_type, "trace_replay_bundle");
  assert.equal(trace.payload.trace_id, resolution.payload.trace_id);
  assert.equal(trace.payload.replay.matches, true);
});

test("returns stable trust explanation resources", async (t) => {
  const { api } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");
  await seedValidator(api, "validator_good_2");

  await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "explain-evidence" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-explain-1",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      outcome: { status: "success", latency_ms: 1200, cost_usd: 0.03, quality_score: 0.88, confidence_score: 0.83 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.91, reason_codes: ["evidence_sufficient"] }
      ],
      provenance: { source_system: "tests" }
    }
  });

  const resolution = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
    }
  });
  const explanation = await api(`/v1/trust/agent_primary/explain?context_hash=${encodeURIComponent(resolution.payload.context_hash)}`);
  assert.equal(explanation.status, 200);
  assert.equal(explanation.payload.resource_type, "trust_explanation");
  assert.equal(explanation.payload.resolution.trace_id, resolution.payload.trace_id);
});

test("returns canonical trust resolution objects across response modes", async (t) => {
  const { api } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");

  await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "mode-shape-evidence" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-mode-shape-1",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      outcome: { status: "success", latency_ms: 900, cost_usd: 0.02, quality_score: 0.9, confidence_score: 0.84 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.9, reason_codes: ["evidence_sufficient"] }
      ],
      provenance: { source_system: "tests" }
    }
  });

  for (const responseMode of ["minimal", "standard", "explain", "audit"]) {
    const resolution = await api("/v1/trust/resolve", {
      method: "POST",
      body: {
        subject_id: "agent_primary",
        context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
        response_mode: responseMode
      }
    });

    assert.equal(resolution.status, 200);
    assert.equal(typeof resolution.payload.resolution_id, "string");
    assert.equal(resolution.payload.subject_id, "agent_primary");
    assert.equal(typeof resolution.payload.score, "number");
    assert.equal(typeof resolution.payload.trace_id, "string");
  }
});

test("evaluates disputes as first-class traceable artifacts through API and SDK", async (t) => {
  const { api, sdk } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");
  await seedValidator(api, "validator_good_2");

  const baseline = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "dispute-baseline" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-dispute-1",
      context: {
        task_type: "market_analysis",
        domain: "crypto",
        risk_level: "high",
        capital_exposure_usd: 25000,
        downstream_impact_score: 0.8
      },
      outcome: { status: "success", latency_ms: 950, cost_usd: 0.04, quality_score: 0.91, confidence_score: 0.86 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.91, reason_codes: ["evidence_sufficient"] },
        { validator_id: "validator_good_2", verdict: "pass", weight: 0.89, reason_codes: ["independent_cluster"] }
      ],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(baseline.status, 202);

  const reversal = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "dispute-reversal" },
    body: {
      subject_id: "agent_primary",
      event_type: "validation.reversed",
      task_id: "task-dispute-1",
      context: {
        task_type: "market_analysis",
        domain: "crypto",
        risk_level: "high",
        capital_exposure_usd: 25000
      },
      outcome: { status: "reversed", latency_ms: 1200, cost_usd: 0.04, quality_score: 0.28, confidence_score: 0.24 },
      validators: [
        { validator_id: "validator_good_1", verdict: "fail", weight: 0.93, reason_codes: ["reversal_confirmed"] }
      ],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(reversal.status, 202);

  const evaluation = await api("/v1/disputes/evaluate", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      task_id: "task-dispute-1",
      evidence_ids: [baseline.payload.evidence_id, reversal.payload.evidence_id],
      context: {
        task_type: "market_analysis",
        domain: "crypto",
        risk_level: "high",
        capital_exposure_usd: 25000
      },
      reason_code: "validator_reversal_conflict",
      severity: "high",
      preferred_resolution: "reverse_validation_credit",
      disputed_by: "validator_good_2"
    }
  });
  assert.equal(evaluation.status, 200);
  assert.equal(evaluation.payload.subject_id, "agent_primary");
  assert.ok(Array.isArray(evaluation.payload.actions));
  assert.equal(typeof evaluation.payload.evaluation.recommended_resolution, "string");

  const trace = await api(`/v1/traces/${evaluation.payload.trace_id}`);
  assert.equal(trace.status, 200);
  assert.equal(trace.payload.trace.outputs.dispute_id, evaluation.payload.dispute_id);

  const sdkEvaluation = await sdk.disputes.evaluate({
    subjectId: "agent_primary",
    taskId: "task-dispute-1",
    evidenceIds: [baseline.payload.evidence_id, reversal.payload.evidence_id],
    context: {
      taskType: "market_analysis",
      domain: "crypto",
      riskLevel: "high",
      capital_exposure_usd: 25000
    },
    reasonCode: "validator_reversal_conflict",
    severity: "critical",
    preferredResolution: "quarantine_subject",
    disputedBy: "validator_good_1"
  });
  assert.equal(sdkEvaluation.subject_id, "agent_primary");
  assert.equal(typeof sdkEvaluation.trace_id, "string");
});

test("surfaces shared-issuer, shared-infra, and reversal asymmetry anti-gaming signals", async (t) => {
  const { api, openDb } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");

  const first = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "anti-gaming-first" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-anti-1",
      context: {
        task_type: "market_analysis",
        domain: "crypto",
        risk_level: "medium",
        capital_exposure_usd: 15000,
        downstream_impact_score: 0.7
      },
      outcome: { status: "success", latency_ms: 1020, cost_usd: 0.02, quality_score: 0.9, confidence_score: 0.83 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.93, reason_codes: ["evidence_sufficient"] }
      ],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(first.status, 202);

  const second = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "anti-gaming-second" },
    body: {
      subject_id: "agent_primary",
      event_type: "validation.reversed",
      task_id: "task-anti-1",
      context: {
        task_type: "market_analysis",
        domain: "crypto",
        risk_level: "medium",
        capital_exposure_usd: 15000
      },
      outcome: { status: "reversed", latency_ms: 1100, cost_usd: 0.02, quality_score: 0.25, confidence_score: 0.2 },
      validators: [
        { validator_id: "validator_good_1", verdict: "fail", weight: 0.95, reason_codes: ["reversal_confirmed"] }
      ],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(second.status, 202);

  const resolution = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "medium" }
    }
  });
  assert.equal(resolution.status, 200);
  assert.ok(resolution.payload.reason_codes.includes("shared_issuer_dependency"));
  assert.ok(resolution.payload.reason_codes.includes("shared_infra_dependency"));
  assert.ok(resolution.payload.reason_codes.includes("reversal_asymmetry_penalty"));

  const db = openDb();
  const snapshotRow = db.prepare("SELECT vector FROM trust_snapshots WHERE subject_id = ?").get("agent_primary");
  const vector = JSON.parse(snapshotRow.vector);
  assert.ok(vector.shared_issuer_ratio > 0);
  assert.ok(vector.shared_infra_ratio > 0);
  assert.ok(vector.reversal_asymmetry > 0);
});

test("registers signed webhooks and retries failed deliveries", async (t) => {
  const deliveries = [];
  let attempts = 0;
  const secret = "super-secret-key";
  const listener = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      attempts += 1;
      const body = Buffer.concat(chunks).toString("utf8");
      deliveries.push({
        headers: req.headers,
        body: JSON.parse(body)
      });
      if (attempts === 1) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  t.after(() => listener.close());
  const address = listener.address();
  const webhookUrl = `http://127.0.0.1:${address.port}/trust-hook`;

  const { api } = await startServer(t, {
    webhookRetryBaseMs: 50
  });
  await registerStandardSubjects(api);

  const webhook = await api("/v1/webhooks", {
    method: "POST",
    body: {
      url: webhookUrl,
      secret,
      event_types: ["task.completed"],
      subjects: ["agent_primary"],
      max_attempts: 3
    }
  });
  assert.equal(webhook.status, 201);
  assert.equal(webhook.payload.signing_alg, "hmac-sha256");

  const evidence = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "webhook-evidence" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-webhook-1",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "medium" },
      outcome: { status: "success", latency_ms: 900, cost_usd: 0.01, quality_score: 0.93, confidence_score: 0.82 },
      validators: [],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(evidence.status, 202);

  await waitFor(() => deliveries.length >= 2 ? deliveries : null, 4000);
  const successfulDelivery = deliveries.at(-1);
  const expectedSignature = `sha256=${createHmac("sha256", secret).update(JSON.stringify(successfulDelivery.body)).digest("hex")}`;
  assert.equal(successfulDelivery.headers["x-infopunks-signature"], expectedSignature);
  assert.equal(successfulDelivery.headers["x-infopunks-attempt"], "2");
  assert.equal(successfulDelivery.body.event_type, "task.completed");
});

test("supports quorum-aware validator selection and executor rerouting", async (t) => {
  const { api, sdk } = await startServer(t);

  await registerPassport(api, {
    subject_id: "agent_requester",
    subject_type: "agent",
    did: "did:key:agent_requester",
    public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_requester" }],
    capabilities: [{ name: "research", version: "1.0", verified: true }],
    metadata: { owner_org: "tests", framework: "openai-agents-sdk" }
  });

  for (const subjectId of ["validator_quorum_1", "validator_quorum_2", "validator_quorum_3", "exec_primary", "exec_backup"]) {
    const metadataBySubject = {
      validator_quorum_1: { owner_org: "tests", framework: "openai-agents-sdk" },
      validator_quorum_2: { owner_org: "validator-lab-2", framework: "runtime-v2" },
      validator_quorum_3: { owner_org: "validator-lab-3", framework: "runtime-v3" },
      exec_primary: { owner_org: "exec-primary-lab", framework: "runtime-exec-primary" },
      exec_backup: { owner_org: "exec-backup-lab", framework: "runtime-exec-backup" }
    };
    await registerPassport(api, {
      subject_id: subjectId,
      subject_type: subjectId.startsWith("validator") ? "validator" : "agent",
      did: `did:key:${subjectId}`,
      public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: `base58:${subjectId}` }],
      capabilities: [
        ...(subjectId.startsWith("validator") ? [{ name: "validation", version: "1.0", verified: true }] : []),
        ...(subjectId.startsWith("exec") ? [{ name: "execution", version: "1.0", verified: true }] : [])
      ],
      metadata: metadataBySubject[subjectId]
    });
  }

  for (const validatorId of ["validator_quorum_1", "validator_quorum_2", "validator_quorum_3"]) {
    await seedValidator(api, validatorId, `${validatorId}-seed`);
  }

  for (const executorId of ["exec_primary", "exec_backup"]) {
    const rounds = executorId === "exec_backup" ? 4 : 2;
    for (let index = 0; index < rounds; index += 1) {
      const response = await api("/v1/evidence", {
        method: "POST",
        headers: { "Idempotency-Key": `${executorId}-${index}` },
        body: {
          subject_id: executorId,
          event_type: index === 1 && executorId === "exec_primary" ? "validation.reversed" : "task.completed",
          task_id: `${executorId}-task-${index}`,
          context: {
            task_type: "execution_bootstrap",
            domain: "crypto",
            risk_level: "medium",
            capital_exposure_usd: executorId === "exec_primary" ? 20000 : 5000
          },
          outcome: {
            status: index === 1 && executorId === "exec_primary" ? "reversed" : "success",
            latency_ms: 1000 + index * 200,
            cost_usd: 0.02,
            quality_score: executorId === "exec_primary" && index === 1 ? 0.25 : 0.9,
            confidence_score: executorId === "exec_primary" && index === 1 ? 0.22 : 0.84
          },
          validators: executorId === "exec_primary"
            ? [{ validator_id: "validator_quorum_1", verdict: index === 1 ? "fail" : "pass", weight: 0.92, reason_codes: ["seed"] }]
            : [
                { validator_id: "validator_quorum_2", verdict: "pass", weight: 0.91, reason_codes: ["seed"] },
                { validator_id: "validator_quorum_3", verdict: "pass", weight: 0.9, reason_codes: ["independent_cluster"] }
              ],
          provenance: { source_system: "tests" }
        }
      });
      assert.equal(response.status, 202);
    }
  }

  const validatorRoute = await api("/v1/routing/select-validator", {
    method: "POST",
    body: {
      task_id: "task-quorum-1",
      subject_id: "agent_requester",
      candidates: ["validator_quorum_1", "validator_quorum_2", "validator_quorum_3"],
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      minimum_count: 2,
      quorum_policy: {
        mode: "threshold",
        required_count: 2,
        consensus_threshold: 0.6,
        escalation_action: "additional_validators"
      }
    }
  });
  assert.equal(validatorRoute.status, 200);
  assert.equal(validatorRoute.payload.quorum.mode, "threshold");
  assert.equal(typeof validatorRoute.payload.quorum.satisfied, "boolean");

  const executorRoute = await sdk.routing.selectExecutor({
    taskId: "task-exec-1",
    subjectId: "agent_requester",
    candidates: ["exec_primary", "exec_backup"],
    context: { taskType: "market_analysis", domain: "crypto", riskLevel: "medium" },
    allowAutonomyDowngrade: true
  });
  assert.equal(executorRoute.route_type, "executor_selection");
  assert.equal(executorRoute.rerouted, true);
  assert.equal(executorRoute.selected[0].subject_id, "exec_backup");
});

test("streams trust events over SSE", async (t) => {
  const { api, baseUrl } = await startServer(t);
  await registerStandardSubjects(api);

  const response = await fetch(`${baseUrl}/v1/events/stream?types=task.completed&subjects=agent_primary&since=0`, {
    headers: {
      authorization: `Bearer ${API_KEY}`
    }
  });
  assert.equal(response.status, 200);

  const record = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "sse-evidence-1" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-sse-1",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "medium" },
      outcome: { status: "success", latency_ms: 1000, cost_usd: 0.01, quality_score: 0.9, confidence_score: 0.8 },
      validators: [],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(record.status, 202);

  const event = await readSseEvent(response, "task.completed");
  assert.equal(event.event_type, "task.completed");
  assert.equal(event.subject_id, "agent_primary");
});

test("caps concurrent SSE streams per API key", async (t) => {
  const { baseUrl } = await startServer(t, {
    sseMaxStreamsPerKey: 1
  });

  const first = await fetch(`${baseUrl}/v1/events/stream?since=0`, {
    headers: { authorization: `Bearer ${API_KEY}` }
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${baseUrl}/v1/events/stream?since=0`, {
    headers: { authorization: `Bearer ${API_KEY}` }
  });
  assert.equal(second.status, 429);
  const payload = await second.json();
  assert.equal(payload.error.code, "RATE_LIMITED");

  await first.body?.cancel();
});

test("applies route-aware rate limits", async (t) => {
  const { api } = await startServer(t, {
    rateLimits: {
      read: { cost: 1, limit: 10 },
      write: { cost: 1, limit: 1 },
      stream: { cost: 1, limit: 5 },
      sim: { cost: 1, limit: 1 }
    }
  });

  const first = await api("/v1/passports", {
    method: "POST",
    body: {
      subject_id: "agent_rate_one",
      subject_type: "agent",
      did: "did:key:agent_rate_one",
      public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_rate_one" }],
      capabilities: [{ name: "research", version: "1.0", verified: true }],
      metadata: { owner_org: "tests" }
    },
    headers: { "Idempotency-Key": "rate-limit-first" }
  });
  assert.equal(first.status, 201);

  const second = await api("/v1/passports", {
    method: "POST",
    body: {
      subject_id: "agent_rate_two",
      subject_type: "agent",
      did: "did:key:agent_rate_two",
      public_keys: [{ kid: "key_primary", alg: "EdDSA", public_key: "base58:agent_rate_two" }],
      capabilities: [{ name: "research", version: "1.0", verified: true }],
      metadata: { owner_org: "tests" }
    },
    headers: { "Idempotency-Key": "rate-limit-second" }
  });
  assert.equal(second.status, 429);
  assert.equal(second.payload.error.code, "RATE_LIMITED");
});

test("returns War Room state resources", async (t) => {
  const { api } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");
  await seedValidator(api, "validator_good_2");
  const evidence = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "war-room-evidence" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-war-room-1",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      outcome: { status: "success", latency_ms: 1000, cost_usd: 0.02, quality_score: 0.9, confidence_score: 0.82 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.9, reason_codes: ["evidence_sufficient"] }
      ],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(evidence.status, 202);
  const resolution = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
    }
  });
  assert.equal(resolution.status, 200);
  const replay = await api(`/v1/traces/${resolution.payload.trace_id}`);
  assert.equal(replay.status, 200);
  const state = await api("/v1/war-room/state");
  assert.equal(state.status, 200);
  assert.equal(state.payload.resource_type, "war_room_state");
  assert.ok(Array.isArray(state.payload.live_trust_event_feed));
  assert.ok(Array.isArray(state.payload.recent_trace_replays));
  assert.ok(Array.isArray(state.payload.recent_alerts));
  assert.equal(typeof state.payload.observability.average_event_lag_ms, "number");
});

test("enforces idempotency conflicts and deterministic repeated resolve", async (t) => {
  const { api, sdk } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");
  await seedValidator(api, "validator_good_2");

  const evidencePayload = {
    subject_id: "agent_primary",
    event_type: "task.completed",
    task_id: "task-primary-1",
    context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
    outcome: { status: "success", latency_ms: 1400, cost_usd: 0.04, quality_score: 0.89, confidence_score: 0.84 },
    validators: [
      { validator_id: "validator_good_1", verdict: "pass", weight: 0.93, reason_codes: ["evidence_sufficient"] },
      { validator_id: "validator_good_2", verdict: "pass", weight: 0.92, reason_codes: ["independent_cluster"] }
    ],
    provenance: { source_system: "tests" }
  };

  const evidenceOne = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "agent-primary-evidence-1" },
    body: evidencePayload
  });
  const evidenceTwo = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "agent-primary-evidence-1" },
    body: evidencePayload
  });
  assert.equal(evidenceOne.status, 202);
  assert.equal(evidenceTwo.status, 202);
  assert.equal(evidenceOne.payload.evidence_id, evidenceTwo.payload.evidence_id);

  const conflict = await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "agent-primary-evidence-1" },
    body: { ...evidencePayload, task_id: "conflict-task" }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.error.code, "IDEMPOTENCY_CONFLICT");

  const firstResolve = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
    }
  });
  const secondResolve = await api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" }
    }
  });
  assert.equal(firstResolve.status, 200);
  assert.equal(secondResolve.status, 200);
  assert.equal(firstResolve.payload.score, secondResolve.payload.score);
  assert.deepEqual(firstResolve.payload.score_breakdown, secondResolve.payload.score_breakdown);

  const sdkResolve = await sdk.trust.resolve({
    subjectId: "agent_primary",
    context: {
      taskType: "market_analysis",
      domain: "crypto",
      riskLevel: "high",
      requiresValidation: true
    },
    candidateValidators: ["validator_good_1", "validator_good_2"]
  });
  assert.equal(sdkResolve.subject_id, "agent_primary");
  assert.ok(Array.isArray(sdkResolve.recommended_validators));
});

test("quotes trust-call budgets and decorates responses with cost metadata", async (t) => {
  const { api } = await startServer(t);
  await registerStandardSubjects(api);

  const quote = await api("/v1/budget/quote", {
    method: "POST",
    body: {
      operation: "trust.resolve",
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      response_mode: "audit",
      evidence_window: 40,
      budget_cap_units: 8
    }
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.payload.operation, "trust.resolve");
  assert.equal(typeof quote.payload.estimated_compute_units, "number");
  assert.equal(typeof quote.payload.response_cost.compute_units, "number");
  assert.equal(typeof quote.payload.budget_hints.recommended_response_mode, "string");

  const prompt = await api("/v1/prompts/trust-aware-execution");
  assert.equal(prompt.status, 200);
  assert.equal(typeof prompt.payload.response_cost.estimated_cost_usd, "number");
  assert.equal(typeof prompt.payload.budget_hints.budget_status, "string");
});

test("dedupes repeated evidence payloads even without explicit idempotency keys", async (t) => {
  const { api } = await startServer(t);
  await registerStandardSubjects(api);

  const payload = {
    subject_id: "agent_primary",
    event_type: "task.completed",
    task_id: "task-dedupe-1",
    context: { task_type: "market_analysis", domain: "crypto", risk_level: "medium" },
    outcome: { status: "success", latency_ms: 1100, cost_usd: 0.02, quality_score: 0.9, confidence_score: 0.81 },
    validators: [],
    provenance: { source_system: "tests", trace_id: "trc_dedupe_1" }
  };

  const first = await api("/v1/evidence", { method: "POST", body: payload });
  const second = await api("/v1/evidence", { method: "POST", body: payload });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(first.payload.evidence_id, second.payload.evidence_id);
});

test("exports and imports signed trust portability bundles across control-plane instances", async (t) => {
  const source = await startServer(t);
  const target = await startServer(t);
  await registerStandardSubjects(source.api);
  await seedValidator(source.api, "validator_good_1");
  await seedValidator(source.api, "validator_good_2");

  const evidence = await source.api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "portable-evidence-1" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-portable-1",
      context: {
        task_type: "market_analysis",
        domain: "crypto",
        risk_level: "high",
        capital_exposure_usd: 42000
      },
      outcome: { status: "success", latency_ms: 880, cost_usd: 0.05, quality_score: 0.93, confidence_score: 0.88 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.93, reason_codes: ["evidence_sufficient"] },
        { validator_id: "validator_good_2", verdict: "pass", weight: 0.91, reason_codes: ["independent_cluster"] }
      ],
      provenance: { source_system: "tests" }
    }
  });
  assert.equal(evidence.status, 202);

  const exported = await source.api("/v1/portability/export", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      include_evidence: true,
      evidence_limit: 10,
      include_trace_ids: true,
      target_network: "target-local"
    }
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.payload.resource_type, "trust_portability_bundle");
  assert.equal(typeof exported.payload.receipt.signature, "string");

  const imported = await target.api("/v1/portability/import", {
    method: "POST",
    body: {
      bundle: exported.payload,
      import_mode: "merge"
    }
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.payload.imported, true);
  assert.equal(imported.payload.receipt_verified, true);

  const importedPassport = await target.api("/v1/passports/agent_primary");
  assert.equal(importedPassport.status, 200);
  assert.equal(importedPassport.payload.subject_id, "agent_primary");

  const importedResolve = await target.api("/v1/trust/resolve", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "medium" }
    }
  });
  assert.equal(importedResolve.status, 200);
});

test("exposes economic hooks for escrow, risk pricing, and attestation bundles", async (t) => {
  const { api, sdk } = await startServer(t);
  await registerStandardSubjects(api);
  await seedValidator(api, "validator_good_1");
  await seedValidator(api, "validator_good_2");

  await api("/v1/evidence", {
    method: "POST",
    headers: { "Idempotency-Key": "economic-evidence-1" },
    body: {
      subject_id: "agent_primary",
      event_type: "task.completed",
      task_id: "task-economic-1",
      context: {
        task_type: "market_analysis",
        domain: "crypto",
        risk_level: "high",
        capital_exposure_usd: 30000,
        requires_external_verification: true
      },
      outcome: { status: "success", latency_ms: 930, cost_usd: 0.03, quality_score: 0.91, confidence_score: 0.85 },
      validators: [
        { validator_id: "validator_good_1", verdict: "pass", weight: 0.92, reason_codes: ["evidence_sufficient"] }
      ],
      provenance: { source_system: "tests" }
    }
  });

  const escrow = await api("/v1/economic/escrow-quote", {
    method: "POST",
    body: {
      subject_id: "agent_primary",
      task_id: "task-economic-1",
      context: { task_type: "market_analysis", domain: "crypto", risk_level: "high" },
      notional_usd: 50000
    }
  });
  assert.equal(escrow.status, 200);
  assert.equal(typeof escrow.payload.escrow_ratio, "number");

  const riskPrice = await sdk.economic.riskPrice({
    subjectId: "agent_primary",
    context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high" },
    notionalUsd: 50000,
    durationHours: 48
  });
  assert.equal(typeof riskPrice.premium_bps, "number");
  assert.equal(typeof riskPrice.policy_extensions.extension_interface, "string");

  const attestation = await sdk.economic.attestationBundle({
    subjectId: "agent_primary",
    context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high" },
    includeRecentEvidence: true,
    evidenceLimit: 5
  });
  assert.equal(attestation.resource_type, "attestation_bundle");
  assert.equal(typeof attestation.signature, "string");
  assert.ok(Array.isArray(attestation.evidence_refs));
});

test("openapi contract includes the public V1 surface", async () => {
  const body = readFileSync(openApiPath, "utf8");
  for (const expected of [
    "/v1/budget/quote:",
    "/v1/passports:",
    "/v1/passports/{subjectId}/rotate-key:",
    "/v1/evidence:",
    "/v1/webhooks:",
    "/v1/portability/export:",
    "/v1/portability/import:",
    "/v1/disputes/evaluate:",
    "/v1/trust/resolve:",
    "/v1/routing/select-validator:",
    "/v1/routing/select-executor:",
    "/v1/economic/escrow-quote:",
    "/v1/economic/risk-price:",
    "/v1/economic/attestation-bundle:",
    "/v1/events/stream:",
    "/v1/traces/{traceId}:",
    "/v1/trust/{subjectId}/explain:",
    "BudgetQuoteRequest:",
    "BudgetQuote:",
    "TrustPortabilityBundle:",
    "PortabilityImportResult:",
    "EscrowQuote:",
    "RiskPriceQuote:",
    "AttestationBundle:",
    "WebhookCreateRequest:",
    "WebhookSubscription:",
    "RoutingSelectExecutorRequest:",
    "QuorumPolicy:",
    "DisputeEvaluateRequest:",
    "DisputeEvaluation:",
    "PassportRotateKeyRequest:",
    "PassportLifecycle:",
    "PassportPortability:",
    "PromptPack:",
    "TraceReplayBundle:",
    "TrustExplainResponse:"
  ]) {
    assert.match(body, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
