import test from "node:test";
import assert from "node:assert/strict";

import { createAgenticTrustClient, resolveTrust, UnsafeExecutorError } from "../packages/trust-sdk/agentic-hook.mjs";

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("trusted executor executes", async () => {
  await withMockFetch(
    async () => jsonResponse({
      entity_id: "agent_trusted",
      trust_score: 82,
      trust_tier: "trusted",
      mode: "verified",
      confidence: 0.91,
      policy: { route: "allow", reason: "trusted_path" }
    }),
    async () => {
      const client = createAgenticTrustClient({ baseUrl: "http://localhost:4021" });
      const decision = await client.requireTrustedExecutor({
        subject_id: "agent_trusted",
        context: { task_type: "execution" },
        minScore: 50
      });

      assert.equal(decision.subject_id, "agent_trusted");
      assert.equal(decision.mode, "verified");
      assert.equal(decision.decision, "allow");
    }
  );
});

test("low-trust executor is blocked", async () => {
  await withMockFetch(
    async () => jsonResponse({
      entity_id: "agent_low",
      trust_score: 31,
      trust_tier: "unverified",
      mode: "verified",
      confidence: 0.95,
      policy: { route: "block", reason: "low_score" }
    }),
    async () => {
      const client = createAgenticTrustClient({ baseUrl: "http://localhost:4021" });
      await assert.rejects(
        () => client.requireTrustedExecutor({
          subject_id: "agent_low",
          context: { task_type: "execution" },
          minScore: 50
        }),
        (error) => error instanceof UnsafeExecutorError && error.code === "UNSAFE_EXECUTOR"
      );
    }
  );
});

test("degraded low-confidence response is blocked", async () => {
  await withMockFetch(
    async () => jsonResponse({
      entity_id: "agent_degraded_low_conf",
      trust_score: 65,
      trust_tier: "unverified",
      mode: "degraded",
      confidence: 0.3,
      policy: { route: "degrade", reason: "upstream_timeout" }
    }),
    async () => {
      const client = createAgenticTrustClient({
        baseUrl: "http://localhost:4021",
        minConfidence: 0.5
      });

      await assert.rejects(
        () => client.requireTrustedExecutor({
          subject_id: "agent_degraded_low_conf",
          context: { task_type: "execution" },
          minScore: 50
        }),
        (error) => error instanceof UnsafeExecutorError && error.code === "UNSAFE_EXECUTOR"
      );
    }
  );
});

test("degraded acceptable response can pass", async () => {
  await withMockFetch(
    async () => jsonResponse({
      entity_id: "agent_degraded_ok",
      trust_score: 68,
      trust_tier: "unverified",
      mode: "degraded",
      confidence: 0.62,
      policy: { route: "degrade", reason: "cached_fallback" }
    }),
    async () => {
      const client = createAgenticTrustClient({
        baseUrl: "http://localhost:4021",
        minConfidence: 0.5
      });

      const decision = await client.requireTrustedExecutor({
        subject_id: "agent_degraded_ok",
        context: { task_type: "execution" },
        minScore: 50
      });

      assert.equal(decision.subject_id, "agent_degraded_ok");
      assert.equal(decision.mode, "degraded");
      assert.equal(decision.decision, "degrade");
    }
  );
});

test("direct resolveTrust helper returns normalized decision", async () => {
  await withMockFetch(
    async () => jsonResponse({
      entity_id: "agent_direct",
      trust_score: 74,
      trust_tier: "trusted",
      mode: "verified",
      confidence: 0.88,
      policy: { route: "allow", reason: "direct_helper" }
    }),
    async () => {
      process.env.INFOPUNKS_TRUST_API_URL = "http://localhost:4021";
      const decision = await resolveTrust({
        subject_id: "agent_direct",
        context: { task_type: "execution" }
      });
      assert.equal(decision.subject_id, "agent_direct");
      assert.equal(decision.decision, "allow");
    }
  );
});
