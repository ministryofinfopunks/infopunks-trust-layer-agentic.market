# Quickstart

## Goal

Get a full Infopunks V1 loop working in under five minutes:

1. start the API
2. install the SDK
3. register a Passport
4. ingest evidence
5. resolve trust
6. route validators
7. watch the War Room move
8. replay a trace

## Start the control plane

```bash
npm install
npm run local:up -- --fresh
```

This is the fastest local path. It starts the API, creates a fresh local SQLite database, seeds demo traffic, and leaves the stack running for direct interaction and stress testing.

Manual mode is still available:

```bash
npm start
```

## Install the SDK

```bash
npm install @infopunks/trust-sdk
```

Minimal live loop:

```js
import { Infopunks } from "@infopunks/trust-sdk";

const ip = new Infopunks({
  apiKey: process.env.INFOPUNKS_API_KEY || "dev-infopunks-root-key",
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
  context: { taskType: "market_analysis", domain: "crypto", riskLevel: "medium", requiresValidation: true },
  candidateValidators: ["validator_001", "validator_002"],
  responseMode: "standard"
});

console.log({
  score: trust.score,
  band: trust.band,
  decision: trust.decision,
  recommended_validators: trust.recommended_validators.map(({ subject_id }) => subject_id),
  trace_id: trust.trace_id
});
```

Environment variables:

- `INFOPUNKS_API_KEY`: bearer token for all API requests. `npm run local:up -- --fresh` prints the active root key and defaults to `dev-infopunks-root-key`; manual `npm start` still uses `dev-infopunks-key` unless overridden.
- `INFOPUNKS_API_KEYS_JSON`: optional scoped API key registry for V1 local/dev authz.
- `INFOPUNKS_ENVIRONMENT`: control-plane environment binding for API keys. Default is `local`.
- `PORT`: server port. Default is `4010`.
- `INFOPUNKS_DB_PATH`: SQLite file path for local/dev mode. Default is the repository-local `data/infopunks.db`.

## Run the demo simulator

```bash
npm run sim:demo
```

The simulator seeds 10 agents, 3 validators, a collusion cluster, reversal pressure, routing decisions, and quarantine candidates. War Room movement appears within a few seconds.

## Portability and economic hooks

```js
const bundle = await ip.portability.export({
  subjectId: "agent_221",
  includeEvidence: true,
  targetNetwork: "staging"
});

const escrow = await ip.economic.escrowQuote({
  subjectId: "agent_221",
  context: { taskType: "market_analysis", domain: "crypto", riskLevel: "high" },
  notionalUsd: 50000
});

console.log(bundle.receipt, escrow);
```

## Open the War Room

[http://127.0.0.1:4010/war-room](http://127.0.0.1:4010/war-room)

## Replay a trace

```bash
npm run replay -- trc_...
```

## Sanity checks

```bash
npm run ci
```
