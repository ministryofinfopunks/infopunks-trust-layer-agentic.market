# agentic-trust-routing-demo

Agentic flow: `discover -> resolve trust -> route validator -> execute (gated)`

## Demo objective

Show Infopunks Trust Score as an MCP-discoverable paid service for agents without agent API keys.

## Run

```bash
npm start
node services/mcp-adapter/src/index.mjs
```

## MCP flow

1. `tools/list` discovers Infopunks trust tools.
2. `resolve_trust` charges `1` unit and returns compact trust decision.
3. `select_validators` charges `2` units and returns selected validators.
4. inspect `meta.x402_receipt` and `meta.spend_controls`.

## SDK snippet (from an MCP client)

```js
const trust = await mcp.callTool("resolve_trust", {
  agent: { agent_id: "router_alpha", did: "did:agentic:router_alpha" },
  context: { task_type: "route_execution", domain: "defi", risk_level: "high" },
  candidate_validators: ["validator_a", "validator_b"],
  payment: { rail: "x402", payer: "router_alpha", units_authorized: 1, nonce: "n1" }
});

const routing = await mcp.callTool("select_validators", {
  agent: { agent_id: "router_alpha" },
  task_id: "task_9001",
  candidates: ["validator_a", "validator_b", "validator_c"],
  context: { task_type: "validation", domain: "defi", risk_level: "high" },
  payment: { rail: "x402", payer: "router_alpha", units_authorized: 2, nonce: "n2" }
});
```

## Visual proof cases

- Trust collapse -> reroute
- Validator conflict -> dispute/evidence escalation
- Ranking shift after new evidence

Use `GET /v1/war-room/state` to observe live feed and route shifts while running the above calls.
