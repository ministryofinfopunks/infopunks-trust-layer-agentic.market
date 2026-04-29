import test from "node:test";
import assert from "node:assert/strict";

import { InfopunksApiClient } from "../services/mcp-adapter/src/client/infopunks-api-client.mjs";

test("InfopunksApiClient sends Authorization Bearer token to core API", async (t) => {
  const originalFetch = globalThis.fetch;
  let seenRequest = null;

  globalThis.fetch = async (url, init = {}) => {
    seenRequest = { url, init };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new InfopunksApiClient({
    baseUrl: "https://infopunks-core-api.onrender.com",
    token: "internal-service-token",
    tokenSource: "INFOPUNKS_INTERNAL_SERVICE_TOKEN",
    logger: null
  });

  await client.getPassport("agent_001", "mcp_trc_123");

  assert.ok(seenRequest);
  assert.equal(seenRequest.url, "https://infopunks-core-api.onrender.com/v1/passports/agent_001");
  assert.equal(seenRequest.init.method, "GET");
  assert.equal(seenRequest.init.headers.authorization, "Bearer internal-service-token");
  assert.equal(seenRequest.init.headers["X-Adapter-Trace-Id"], "mcp_trc_123");
});
