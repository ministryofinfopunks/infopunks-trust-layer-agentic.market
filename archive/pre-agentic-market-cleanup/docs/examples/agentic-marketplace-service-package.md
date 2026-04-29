# Infopunks as Agentic.Market Service Package

This repository now ships a dedicated MCP service package at `services/mcp-adapter`.

## P0 MCP adapter layer

- MCP HTTP server (`POST /mcp`) with discoverable tools.
- Tool calls translated to existing Infopunks HTTP control-plane endpoints.
- No core trust-engine changes.

## P1 identity bridge

- Maps `agent.identity -> subject_id`.
- Fetches existing Passport or auto-issues one on first call.

## P2 x402 payment gating

- Deterministic unit pricing per tool.
- Per-call x402 verification (facilitator/strict/stub modes).
- Anti-replay protection for nonce/proof/session reuse.
- Receipts persisted in durable adapter state store.
- Daily spend controls enforced before backend invocation.

## P3 compact deterministic responses

`resolve_trust` and routing tools return compact deterministic fields:

```json
{
  "score": 67,
  "decision": "allow_with_validation",
  "validators": ["agent_784"],
  "confidence": 0.79
}
```

## Marketplace listing artifacts

- `services/mcp-adapter/agentic-marketplace.json`
- `services/mcp-adapter/skills.json`
- `examples/agentic-trust-routing-demo/README.md`
