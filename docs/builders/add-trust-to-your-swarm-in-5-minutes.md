# Add Trust To Your Swarm In 5 Minutes

1. Start the control plane:

```bash
npm install
npm run local:up -- --fresh
```

2. Install the SDK:

```ts
import { Infopunks } from "@infopunks/trust-sdk";
```

3. Register the swarm workers with Passports.
4. Resolve trust before execution.
5. Route validators or executors instead of picking them ad hoc.
6. Subscribe to `trust.collapse`, `route.changed`, and `warroom.alert.raised`.
7. Export portability bundles when work crosses network boundaries.

Minimum live loop:

```js
const ip = new Infopunks({ apiKey: "dev-infopunks-key", baseUrl: "http://127.0.0.1:4010" });

await ip.passports.register({ subjectId: "swarm_worker_1", subjectType: "agent", publicKeys: ["did:key:swarm_worker_1"], capabilities: ["execution"] });
const trust = await ip.trust.resolve({ subjectId: "swarm_worker_1", context: { taskType: "research", domain: "crypto", riskLevel: "high" } });
const route = await ip.routing.selectExecutor({ taskId: "task_1", subjectId: "swarm_worker_1", candidates: ["swarm_worker_1"], context: { taskType: "research", domain: "crypto", riskLevel: "high" } });
const stream = ip.events.subscribe("trust.collapse", (event) => console.log(event));
```
