import { Infopunks } from "@infopunks/trust-sdk";

const client = new Infopunks({
  apiKey: process.env.INFOPUNKS_API_KEY || "dev-infopunks-root-key",
  environment: "local",
  baseUrl: process.env.INFOPUNKS_BASE_URL || "http://127.0.0.1:4010",
  timeoutMs: 5000
});

await client.passports.register(
  {
    subjectId: "example_agent_221",
    subjectType: "agent",
    publicKeys: ["did:key:example_agent_221"],
    capabilities: ["research", "validation", "execution"],
    metadata: {
      framework: "openai-agents-sdk",
      ownerOrg: "acme_labs",
      modelClass: "reasoning",
      runtimeVersion: "0.3.1"
    }
  },
  { idempotencyKey: "passport-example_agent_221" }
);

await client.passports.register(
  {
    subjectId: "example_validator_001",
    subjectType: "validator",
    publicKeys: ["did:key:example_validator_001"],
    capabilities: ["validation"],
    metadata: {
      framework: "openai-agents-sdk",
      ownerOrg: "acme_labs",
      modelClass: "reasoning",
      runtimeVersion: "0.3.1"
    }
  },
  { idempotencyKey: "passport-example_validator_001" }
);

await client.evidence.record(
  {
    subjectId: "example_agent_221",
    eventType: "task.completed",
    taskId: "task_7781",
    context: {
      taskType: "market_analysis",
      domain: "crypto",
      riskLevel: "high"
    },
    outcome: {
      status: "success",
      latency_ms: 1820,
      cost_usd: 0.038,
      quality_score: 0.81,
      confidence_score: 0.72
    },
    validators: [
      {
        validatorId: "example_validator_001",
        verdict: "pass",
        weight: 0.88,
        reasonCodes: ["evidence_sufficient", "internally_consistent"]
      }
    ],
    provenance: {
      sourceSystem: "quickstart-agent"
    }
  },
  { idempotencyKey: "evidence-example_task_7781" }
);

const trust = await client.trust.resolve({
  subjectId: "example_agent_221",
  context: {
    taskType: "market_analysis",
    domain: "crypto",
    riskLevel: "medium",
    requiresValidation: true
  },
  candidateValidators: ["example_validator_001"],
  responseMode: "standard"
});

const route = await client.routing.selectValidator({
  taskId: "task_7781",
  subjectId: "example_agent_221",
  candidates: ["example_validator_001"],
  context: {
    taskType: "market_analysis",
    domain: "crypto",
    riskLevel: "medium"
  },
  minimumCount: 1
});

console.log(
  JSON.stringify(
    {
      score: trust.score,
      band: trust.band,
      decision: trust.decision,
      recommended_validators: trust.recommended_validators.map(({ subject_id }) => subject_id),
      trace_id: trust.trace_id,
      routing: {
        routing_id: route.routing_id,
        rerouted: route.rerouted,
        selected: route.selected.map(({ subject_id }) => subject_id)
      }
    },
    null,
    2
  )
);
