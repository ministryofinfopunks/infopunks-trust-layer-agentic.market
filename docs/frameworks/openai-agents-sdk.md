# OpenAI Agents SDK Example

Use Infopunks as a preflight and routing layer around consequential agent actions.

```js
import { Infopunks } from "@infopunks/trust-sdk";

const ip = new Infopunks({
  apiKey: process.env.INFOPUNKS_API_KEY,
  environment: "local",
  baseUrl: "http://127.0.0.1:4010"
});

const budget = await ip.budget.quote({
  operation: "trust.resolve",
  subjectId: "agent_exec_1",
  context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high" },
  responseMode: "minimal",
  budgetCapUnits: 8
});

const trust = await ip.trust.resolve({
  subjectId: "agent_exec_1",
  context: {
    taskType: "market_analysis",
    domain: "crypto",
    riskLevel: "high",
    requiresValidation: true
  },
  responseMode: budget.recommended_response_mode
});

if (trust.decision !== "allow") {
  const route = await ip.routing.selectValidator({
    taskId: "task_7781",
    subjectId: "agent_exec_1",
    candidates: ["validator_001", "validator_002", "validator_003"],
    context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high" },
    minimumCount: 2
  });
  console.log(route);
}
```

Recommended sequence:

1. `ip.budget.quote()` for high-frequency loops.
2. `ip.trust.resolve()` before any tool call with external impact.
3. `ip.routing.selectExecutor()` or `ip.routing.selectValidator()` when autonomy must be shaped by trust.
4. `ip.economic.attestationBundle()` when a downstream marketplace or insurer needs portable proof.
