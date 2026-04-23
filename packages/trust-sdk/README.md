# @infopunks/trust-sdk

Installable trust layer SDK, API client, and event rail for agent systems.

## Install

```bash
npm install @infopunks/trust-sdk
```

## First win

```js
import { Infopunks } from "@infopunks/trust-sdk";

const ip = new Infopunks({
  apiKey: process.env.INFOPUNKS_API_KEY,
  environment: "local",
  baseUrl: "http://127.0.0.1:4010",
  timeoutMs: 5000
});

await ip.passports.register({
  subjectId: "agent_221",
  subjectType: "agent",
  publicKeys: ["did:key:z6MkExample"],
  capabilities: ["research", "validation", "execution"]
});

await ip.evidence.record({
  subjectId: "agent_221",
  eventType: "task.completed",
  taskId: "task_7781",
  context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high" },
  outcome: {
    status: "success",
    latency_ms: 1820,
    cost_usd: 0.038,
    quality_score: 0.81,
    confidence_score: 0.72
  },
  validators: [{ validatorId: "validator_001", verdict: "pass", weight: 0.88, reasonCodes: ["evidence_sufficient"] }],
  provenance: { sourceSystem: "quickstart" }
});

const trust = await ip.trust.resolve({
  subjectId: "agent_221",
  context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high", requiresValidation: true },
  candidateValidators: ["validator_001", "validator_002"],
  responseMode: "standard"
});

const route = await ip.routing.selectValidator({
  taskId: "task_7781",
  subjectId: "agent_221",
  candidates: ["validator_001", "validator_002"],
  context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high" },
  minimumCount: 1
});

console.log({
  score: trust.score,
  band: trust.band,
  decision: trust.decision,
  recommended_validators: trust.recommended_validators.map(({ subject_id }) => subject_id),
  trace_id: trust.trace_id,
  selected: route.selected.map(({ subject_id }) => subject_id)
});
```

## Event rail

```js
const stream = ip.events.subscribe(
  { types: ["trust.collapse", "route.changed"], subjects: ["agent_221"] },
  (event) => console.log(event)
);
```

## Surface

- `ip.passports.register()`
- `ip.passports.get()`
- `ip.passports.rotateKey()`
- `ip.evidence.record()`
- `ip.trust.resolve()`
- `ip.trust.explain()`
- `ip.routing.selectValidator()`
- `ip.routing.selectExecutor()`
- `ip.events.subscribe()`

## Runtime

Node `>= 22.10.0`
