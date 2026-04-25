import { Infopunks } from "../../packages/trust-sdk/index.mjs";

const client = new Infopunks({
  apiKey: process.env.INFOPUNKS_API_KEY || "dev-infopunks-key",
  baseUrl: process.env.INFOPUNKS_BASE_URL || "http://127.0.0.1:4010",
  timeoutMs: 10000
});

const scenario = await client.sim.runScenario({
  scenario: process.argv[2] || "demo",
  domain_mix: ["crypto", "macro", "infra"]
});

console.log(JSON.stringify(scenario, null, 2));
