import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { AdapterStateStore } from "../services/mcp-adapter/src/storage/state-store.mjs";
import { SubjectResolutionService } from "../services/mcp-adapter/src/identity/subject-resolution.mjs";
import { resolveTrustTool } from "../services/mcp-adapter/src/tools/resolve-trust.mjs";

function makeStore(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-auto-bootstrap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new AdapterStateStore({ dbPath: path.join(dir, "adapter.db") });
}

function makeApiClient({ delayCreateMs = 0 } = {}) {
  const passports = new Map();
  let createCount = 0;
  return {
    async getPassport(subjectId) {
      const passport = passports.get(subjectId);
      if (!passport) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return passport;
    },
    async createPassport(input) {
      if (delayCreateMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayCreateMs));
      }
      if (passports.has(input.subject_id)) {
        const error = new Error("already exists");
        error.status = 409;
        throw error;
      }
      createCount += 1;
      passports.set(input.subject_id, {
        passport_id: `psp_${input.subject_id}`,
        subject_id: input.subject_id,
        status: "active",
        metadata: input.metadata ?? {}
      });
      return passports.get(input.subject_id);
    },
    async resolveTrust(input) {
      return {
        subject_id: input.subject_id,
        score: 88,
        confidence: 0.91,
        decision: "allow",
        band: "preferred",
        reason_codes: ["known_subject_path"]
      };
    },
    stats() {
      return {
        createCount,
        passports: new Map(passports)
      };
    }
  };
}

function makeSubjectResolution({ apiClient, store, score = 20 }) {
  return new SubjectResolutionService({
    apiClient,
    mapper: null,
    store,
    config: {
      environment: "test",
      targetResolutionPolicy: "lookup-only",
      autoBootstrapUnknownSubjects: true,
      autoBootstrapTrustScore: score,
      autoBootstrapTrustTier: "unverified"
    }
  });
}

test("unknown subject gets auto-bootstrapped and starts at trust_score 20", async (t) => {
  const store = makeStore(t);
  const apiClient = makeApiClient();
  const subjectResolution = makeSubjectResolution({ apiClient, store, score: 20 });

  const result = await resolveTrustTool({
    args: { subject_id: "agent_unknown_1", context: { task_type: "market_analysis" } },
    subjectResolution,
    apiClient,
    config: { defaultDomain: "general", defaultRiskLevel: "medium", upstreamAttemptTimeoutMs: 50, stateStore: store, logger: null },
    adapterTraceId: "trc_bootstrap_1"
  });

  assert.equal(result.subject_id, "agent_unknown_1");
  assert.equal(result.trust_score, 20);
  assert.equal(result.trust_tier, "unverified");
  assert.equal(result.provisional, true);
  assert.equal(result.reason, "AUTO_BOOTSTRAPPED_SUBJECT");

  const stats = apiClient.stats();
  assert.equal(stats.createCount, 1);
  assert.ok(stats.passports.get("agent_unknown_1"));
});

test("second lookup returns existing passport without recreate", async (t) => {
  const store = makeStore(t);
  const apiClient = makeApiClient();
  const subjectResolution = makeSubjectResolution({ apiClient, store });

  const first = await subjectResolution.resolveTarget("agent_existing_1", { autoBootstrapIfMissing: true }, "trc_bootstrap_2");
  const second = await subjectResolution.resolveTarget("agent_existing_1", { autoBootstrapIfMissing: true }, "trc_bootstrap_3");

  assert.equal(first.subject_id, "agent_existing_1");
  assert.equal(second.subject_id, "agent_existing_1");
  assert.equal(second.created, false);

  const stats = apiClient.stats();
  assert.equal(stats.createCount, 1);
});

test("concurrent bootstrap does not create duplicates", async (t) => {
  const store = makeStore(t);
  const apiClient = makeApiClient({ delayCreateMs: 40 });
  const subjectResolution = makeSubjectResolution({ apiClient, store });

  const [left, right] = await Promise.all([
    subjectResolution.resolveTarget("agent_race_1", { autoBootstrapIfMissing: true }, "trc_race_1"),
    subjectResolution.resolveTarget("agent_race_1", { autoBootstrapIfMissing: true }, "trc_race_2")
  ]);

  assert.equal(left.subject_id, "agent_race_1");
  assert.equal(right.subject_id, "agent_race_1");

  const stats = apiClient.stats();
  assert.equal(stats.createCount, 1);
  assert.ok(stats.passports.get("agent_race_1"));
});

test("known subject path remains unchanged", async (t) => {
  const store = makeStore(t);
  const apiClient = makeApiClient();
  await apiClient.createPassport({ subject_id: "agent_known_1", metadata: { seed: true } });
  const subjectResolution = makeSubjectResolution({ apiClient, store });

  const result = await resolveTrustTool({
    args: { subject_id: "agent_known_1", context: { task_type: "market_analysis" } },
    subjectResolution,
    apiClient,
    config: { defaultDomain: "general", defaultRiskLevel: "medium", upstreamAttemptTimeoutMs: 50, stateStore: store, logger: null },
    adapterTraceId: "trc_known_1"
  });

  assert.equal(result.subject_id, "agent_known_1");
  assert.equal(result.mode, "verified");
  assert.ok(result.confidence >= 0.8);
  assert.notEqual(result.reason, "AUTO_BOOTSTRAPPED_SUBJECT");

  const stats = apiClient.stats();
  assert.equal(stats.createCount, 1);
});
