import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { resolveTrustWithResilience } from "../services/mcp-adapter/src/client/upstream-resilience.mjs";
import { AdapterStateStore } from "../services/mcp-adapter/src/storage/state-store.mjs";

function makeStore(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-upstream-resilience-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new AdapterStateStore({ dbPath: path.join(dir, "adapter.db") });
}

function makeLogger() {
  const entries = [];
  const logger = {
    info(payload) { entries.push({ level: "info", ...payload }); },
    warn(payload) { entries.push({ level: "warn", ...payload }); },
    error(payload) { entries.push({ level: "error", ...payload }); }
  };
  return { logger, entries };
}

test("upstream resilience returns verified response on success", async (t) => {
  const store = makeStore(t);
  const { logger, entries } = makeLogger();

  const result = await resolveTrustWithResilience({
    subjectId: "agent_001",
    cacheStore: store,
    logger,
    attemptTimeoutMs: 900,
    executeUpstream: async ({ timeoutMs }) => {
      assert.equal(timeoutMs, 900);
      return {
        subject_id: "agent_001",
        score: 74,
        confidence: 0.61,
        decision: "allow_with_validation",
        reason_codes: ["upstream_ok"]
      };
    }
  });

  assert.equal(result.mode, "verified");
  assert.ok(result.confidence >= 0.8 && result.confidence <= 1.0);

  const completion = entries.find((entry) => entry.event === "upstream_resilience");
  assert.ok(completion);
  assert.equal(completion.final_status, "success");
  assert.equal(completion.fallback_used, false);

  const cached = store.getCachedTrustForSubject("agent_001");
  assert.ok(cached?.response);
  assert.equal(cached.response.mode, "verified");
});

test("upstream timeout/failure retries then falls back to cached", async (t) => {
  const store = makeStore(t);
  const { logger, entries } = makeLogger();

  store.setCachedTrustForSubject("agent_retry", {
    subject_id: "agent_retry",
    score: 66,
    confidence: 0.87,
    decision: "allow",
    mode: "verified"
  });

  let attempts = 0;
  const result = await resolveTrustWithResilience({
    subjectId: "agent_retry",
    cacheStore: store,
    logger,
    attemptTimeoutMs: 700,
    retryDelaysMs: [1, 1, 1],
    executeUpstream: async () => {
      attempts += 1;
      throw new Error("UPSTREAM_TIMEOUT");
    }
  });

  assert.equal(attempts, 3);
  assert.equal(result.mode, "degraded");
  assert.equal(result.provisional, true);
  assert.equal(result.reason, "CACHED_TRUST_FALLBACK");
  assert.ok(result.confidence < 0.8);

  const completion = entries.find((entry) => entry.event === "upstream_resilience" && entry.fallback_used === true);
  assert.ok(completion);
  assert.equal(completion.final_status, "fallback_cached");
});

test("upstream failure with no cache returns safe default fallback", async (t) => {
  const store = makeStore(t);
  const { logger, entries } = makeLogger();

  let attempts = 0;
  const result = await resolveTrustWithResilience({
    subjectId: "agent_no_cache",
    cacheStore: store,
    logger,
    attemptTimeoutMs: 500,
    retryDelaysMs: [1, 1, 1],
    executeUpstream: async () => {
      attempts += 1;
      throw new Error("UPSTREAM_UNAVAILABLE");
    }
  });

  assert.equal(attempts, 3);
  assert.equal(result.mode, "degraded");
  assert.equal(result.confidence, 0.25);
  assert.equal(result.trust_score, 20);
  assert.equal(result.trust_tier, "unverified");
  assert.equal(result.reason, "SAFE_DEFAULT_FALLBACK");

  const completion = entries.find((entry) => entry.event === "upstream_resilience" && entry.fallback_used === true);
  assert.ok(completion);
  assert.equal(completion.final_status, "fallback_safe_default");
});

test("cached fallback is lower confidence than verified response", async (t) => {
  const store = makeStore(t);
  const { logger } = makeLogger();

  const verified = await resolveTrustWithResilience({
    subjectId: "agent_conf",
    cacheStore: store,
    logger,
    executeUpstream: async () => ({
      subject_id: "agent_conf",
      score: 80,
      confidence: 0.95,
      decision: "allow"
    })
  });

  const degraded = await resolveTrustWithResilience({
    subjectId: "agent_conf",
    cacheStore: store,
    logger,
    retryDelaysMs: [1, 1, 1],
    executeUpstream: async () => {
      throw new Error("UPSTREAM_UNAVAILABLE");
    }
  });

  assert.equal(verified.mode, "verified");
  assert.equal(degraded.mode, "degraded");
  assert.ok(degraded.confidence < verified.confidence);
});
