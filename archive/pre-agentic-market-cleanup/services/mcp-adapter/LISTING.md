# Agentic.Market Listing Surface

## Title
Infopunks Trust Score

## Subtitle
Trust-aware routing and execution gating for autonomous agents.

## One-line Description
Resolve trust, route validators/executors, and enforce auditable risk controls via x402-paid MCP tools.

## Public API aliases
- `POST /trust-score` (paid, HTTP 402 challenge semantics)
- `GET /agent-reputation/:id`
- `POST /verify-evidence`

## Payment rail
- x402
- accepted asset: USDC
- supported network(s): base (configurable)

## Short Description
Infopunks adds a trust and credibility control plane between discovery and execution. Agents use machine-readable MCP tools to evaluate trust, select safer validators/executors, adjudicate disputes, replay traces, and quote exposure risk with receipt-linked payment telemetry.

## Full Description
Infopunks is a marketplace-native trust layer for AI agent systems. It is designed to be called programmatically before consequential actions such as funds movement, write operations, autonomous execution, or cross-agent delegation.

The service returns compact, deterministic outputs for automation and includes adapter/internal trace linkage, payment receipts, and spend controls so buyers can verify both decision quality and billing evidence. This makes Infopunks useful as shared infrastructure for trust-aware orchestration, safety gates, and post-incident replay.

## Categories
- trust-routing
- agent-security
- risk-infrastructure

## Keywords / Tags
- agent trust
- trust score
- validator selection
- executor routing
- dispute evaluation
- trace replay
- risk pricing
- mcp tools
- x402 payable api
- agentic market

## Why agents use this
- Block low-trust routes before execution
- Route validation to independent, high-trust validators
- Route execution to safer executor candidates
- Resolve validator conflicts with explicit dispute outcomes
- Replay traces for audit, reconciliation, and incident response
- Price risk/exposure before capital movement

## Top tools
- `resolve_trust`
- `select_validators`
- `select_executor`
- `evaluate_dispute`
- `get_trace_replay`
- `quote_risk`

## Sample response
```json
{
  "result": {
    "score": 67,
    "decision": "allow_with_validation",
    "recommended_validators": [
      { "subject_id": "agent_784", "score": 91, "fit_score": 0.93 }
    ],
    "confidence": 0.79,
    "trace_id": "trc_..."
  },
  "meta": {
    "tool": "resolve_trust",
    "adapter_trace_id": "mcp_trc_...",
    "internal_trace_id": "trc_...",
    "billed_units": 1,
    "payment_receipt_id": "xrc_..."
  }
}
```

## When agents should call it
- Immediately before any consequential action (fund movement, writes, deployment, autonomous execution)
- Before selecting validators or executors in a swarm
- Whenever conflicting outputs require adjudication

## Why this matters
Infopunks reduces execution risk by turning trust into a paid, auditable control point between discovery and action.
