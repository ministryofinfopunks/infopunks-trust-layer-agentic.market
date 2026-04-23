# LangChain Example

Treat Infopunks as middleware for trust, routing, and economic guardrails.

```ts
import { Infopunks } from "@infopunks/trust-sdk";

const ip = new Infopunks({
  apiKey: process.env.INFOPUNKS_API_KEY!,
  baseUrl: "http://127.0.0.1:4010",
  environment: "local"
});

const trust = await ip.trust.resolve({
  subjectId: "chain_worker_1",
  context: { taskType: "research", domain: "macro", riskLevel: "medium" }
});

const executor = await ip.routing.selectExecutor({
  taskId: "chain-task-1",
  subjectId: "chain_worker_1",
  candidates: ["chain_worker_1", "chain_worker_2", "chain_worker_3"],
  context: { taskType: "research", domain: "macro", riskLevel: "medium" },
  allowAutonomyDowngrade: true
});
```

Recommended LangChain placement:

- Before `AgentExecutor` tool use: `trust.resolve`
- Before assigning a worker node in a graph: `routing.selectExecutor`
- Before expensive multi-review steps: `budget.quote`
- Before cross-org output sharing: `portability.export`
