# Claude / Codex Example

For prompt-driven or tool-driven agents, Infopunks should sit in front of execution, validation, and market-facing handoff.

```js
import { Infopunks } from "@infopunks/trust-sdk";

const ip = new Infopunks({
  apiKey: process.env.INFOPUNKS_API_KEY,
  environment: "local",
  baseUrl: "http://127.0.0.1:4010"
});

const trust = await ip.trust.resolve({
  subjectId: "codex_worker_1",
  context: { taskType: "deployment_plan", domain: "infra", riskLevel: "high", requiresValidation: true }
});

const attestation = await ip.economic.attestationBundle({
  subjectId: "codex_worker_1",
  context: { taskType: "deployment_plan", domain: "infra", riskLevel: "high" },
  includeRecentEvidence: true,
  evidenceLimit: 10
});
```

Prompt guidance:

- Start with `check trust context first`
- Use `trust.resolve` before tool execution
- Use `disputes.evaluate` when reviewers conflict
- Use `economic.attestationBundle` when a downstream runtime needs portable accountability
