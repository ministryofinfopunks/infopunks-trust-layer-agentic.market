import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_POLICY } from "../packages/schema/index.mjs";
import { computeResolution, computeSnapshot, normalizeTrustConfig } from "../packages/trust-engine/index.mjs";

function isoHoursAgo(nowIso, hours) {
  return new Date(new Date(nowIso).getTime() - hours * 60 * 60 * 1000).toISOString();
}

function makePassport(overrides = {}) {
  return {
    passport_id: "psp_1",
    subject_id: "agent_001",
    subject_type: "agent",
    did: "did:key:agent_001",
    status: "active",
    issuer: { issuer_id: "org_infopunks" },
    public_keys: [],
    capabilities: [],
    metadata: { owner_org: "tests", ...(overrides.metadata ?? {}) },
    created_at: "2026-04-20T00:00:00.000Z",
    updated_at: "2026-04-20T00:00:00.000Z",
    ...overrides
  };
}

function makeEvidence(nowIso, {
  id,
  eventType = "task.completed",
  hoursAgo = 1,
  domain = "general",
  riskLevel = "medium",
  quality = 0.9,
  confidence = 0.85,
  validators = [{ validator_id: "validator_1", verdict: "pass", weight: 1, reason_codes: [] }],
  context = {},
  outcome = {}
}) {
  return {
    evidence_id: id,
    subject_id: "agent_001",
    event_type: eventType,
    task_id: `${id}_task`,
    context: {
      task_type: "agentic.market.request",
      domain,
      risk_level: riskLevel,
      ...context
    },
    outcome: {
      status: eventType === "task.completed" ? "success" : "failed",
      latency_ms: 1200,
      cost_usd: 0.01,
      quality_score: quality,
      confidence_score: confidence,
      ...outcome
    },
    validators,
    disputes: [],
    provenance: { source_system: "tests" },
    created_at: isoHoursAgo(nowIso, hoursAgo)
  };
}

function resolveFromEvidence({ nowIso = "2026-04-24T10:00:00.000Z", evidences = [], passport = makePassport(), trustConfig = {} } = {}) {
  const snapshot = computeSnapshot({
    subjectId: passport.subject_id,
    passport,
    evidences,
    nowIso,
    previousSnapshot: null,
    policy: DEFAULT_POLICY,
    trustConfig
  });
  const resolution = computeResolution({
    passport,
    snapshot,
    context: { domain: "general", risk_level: "medium", task_type: "agentic.market.request" },
    policy: DEFAULT_POLICY,
    nowIso,
    trustConfig
  });
  return { snapshot, resolution };
}

test("clean agent improves trust gradually", () => {
  const nowIso = "2026-04-24T10:00:00.000Z";
  const noisy = resolveFromEvidence({
    nowIso,
    evidences: [
      makeEvidence(nowIso, { id: "ev1", eventType: "task.failed", quality: 0.3, confidence: 0.35 }),
      makeEvidence(nowIso, { id: "ev2", eventType: "task.timeout", quality: 0.25, confidence: 0.3 })
    ]
  });
  const clean = resolveFromEvidence({
    nowIso,
    evidences: [
      makeEvidence(nowIso, { id: "ev3", eventType: "task.completed", quality: 0.93, confidence: 0.9 }),
      makeEvidence(nowIso, { id: "ev4", eventType: "task.completed", quality: 0.94, confidence: 0.91 }),
      makeEvidence(nowIso, { id: "ev5", eventType: "task.completed", quality: 0.95, confidence: 0.92 })
    ]
  });

  assert.ok(clean.resolution.score > noisy.resolution.score);
  assert.ok(clean.resolution.trust_vector.executionReliability > noisy.resolution.trust_vector.executionReliability);
});

test("stale evidence causes decay", () => {
  const fresh = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "fresh", hoursAgo: 1 })],
    trustConfig: { decayHalfLifeHours: 24 }
  });
  const stale = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "stale", hoursAgo: 200 })],
    trustConfig: { decayHalfLifeHours: 24 }
  });

  assert.ok(stale.resolution.trust_vector.evidenceFreshness < fresh.resolution.trust_vector.evidenceFreshness);
  assert.ok(stale.resolution.score < fresh.resolution.score);
});

test("replay attempt causes major penalty", () => {
  const baseline = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "base" })]
  });
  const attacked = resolveFromEvidence({
    evidences: [
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "good1" }),
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "replay", eventType: "REPLAY_ATTEMPT", quality: 0.1, confidence: 0.1, validators: [] })
    ]
  });

  assert.ok(attacked.resolution.trust_vector.adversarialRisk >= baseline.resolution.trust_vector.adversarialRisk);
  assert.ok(attacked.resolution.score < baseline.resolution.score);
});

test("duplicate payment signature causes major penalty", () => {
  const baseline = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "base-dup" })]
  }).resolution;
  const resolution = resolveFromEvidence({
    evidences: [
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "good2" }),
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "dup", eventType: "DUPLICATE_PAYMENT_SIGNATURE", quality: 0.1, confidence: 0.1, validators: [] })
    ]
  }).resolution;

  assert.ok(resolution.trust_vector.adversarialRisk > baseline.trust_vector.adversarialRisk);
  assert.ok(resolution.score < baseline.score);
});

test("malformed payload reduces trust", () => {
  const clean = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "good3" })]
  }).resolution;
  const malformed = resolveFromEvidence({
    evidences: [
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "good4" }),
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "bad1", eventType: "MALFORMED_PAYLOAD", validators: [], quality: 0.1, confidence: 0.1 })
    ]
  }).resolution;

  assert.ok(malformed.score < clean.score);
});

test("quarantined agent is blocked", () => {
  const resolution = resolveFromEvidence({
    evidences: [
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "q1", eventType: "QUARANTINE", validators: [], quality: 0.1, confidence: 0.1 }),
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "q2", eventType: "REPLAY_ATTEMPT", validators: [], quality: 0.1, confidence: 0.1 })
    ]
  }).resolution;

  assert.equal(resolution.trust_state, "QUARANTINED");
  assert.equal(resolution.trust_policy.allow, false);
  assert.ok(["BLOCK", "QUARANTINE"].includes(resolution.trust_policy.action));
});

test("low economicIntegrity requires escrow", () => {
  const resolution = resolveFromEvidence({
    evidences: [
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "e1", eventType: "PAYMENT_FAILED", validators: [], quality: 0.2, confidence: 0.2 }),
      makeEvidence("2026-04-24T10:00:00.000Z", { id: "e2", eventType: "task.failed", quality: 0.2, confidence: 0.2 })
    ]
  }).resolution;

  assert.equal(resolution.trust_policy.escrowRequired, true);
});

test("low evidenceFreshness causes degrading state", () => {
  const resolution = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "old1", hoursAgo: 180 })],
    trustConfig: { decayHalfLifeHours: 24 }
  }).resolution;

  assert.equal(resolution.trust_state, "DEGRADING");
  assert.equal(resolution.trust_policy.action, "RATE_LIMIT");
});

test("risky dependency reduces routing priority", () => {
  const base = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "dep-base" })]
  }).resolution;
  const withRiskyDependency = resolveFromEvidence({
    passport: makePassport({
      metadata: {
        owner_org: "tests",
        dependencies: [
          { id: "dep_1", state: "COMPROMISED", health: 20 },
          { id: "dep_2", state: "RISKY", health: 35 }
        ]
      }
    }),
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "dep-risk" })]
  }).resolution;

  assert.ok(withRiskyDependency.trust_vector.dependencyRisk > base.trust_vector.dependencyRisk);
  assert.ok(withRiskyDependency.trust_policy.routingPriority < base.trust_policy.routingPriority);
});

test("backward-compatible score still returns overall trust", () => {
  const resolution = resolveFromEvidence({
    evidences: [makeEvidence("2026-04-24T10:00:00.000Z", { id: "compat" })],
    trustConfig: normalizeTrustConfig({ decayHalfLifeHours: 72 })
  }).resolution;

  assert.equal(typeof resolution.score, "number");
  assert.equal(resolution.score, resolution.trust_vector.overallTrust);
  assert.ok(resolution.trust_policy);
});
