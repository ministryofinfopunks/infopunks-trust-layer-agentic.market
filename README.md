# Infopunks Trust Layer

## What It Is

HTTP service for Agentic.Market trust routing with one paid API call:

- `POST /v1/resolve-trust`

Public endpoints:

- `GET /health`
- `GET /openapi.json`
- `GET /.well-known/infopunks-trust-layer.json`

## 60-Second Onboarding

```bash
npm install
npm start
```

Service default: `http://localhost:4021`

Run launch checks:

```bash
npm run smoke
npm run build
```

## curl Example

Unpaid call (expected `402`):

```bash
curl -i http://localhost:4021/v1/resolve-trust \
  -X POST \
  -H 'content-type: application/json' \
  -d '{
    "subject_id": "agent_221",
    "context": {
      "task_type": "marketplace_routing",
      "domain": "general",
      "risk_level": "medium"
    }
  }'
```

Paid retry (expected `200`):

```bash
curl -i http://localhost:4021/v1/resolve-trust \
  -X POST \
  -H 'content-type: application/json' \
  -H "x-payment: <base64-x402-payment-payload>" \
  -d '{
    "subject_id": "agent_221",
    "context": {
      "task_type": "marketplace_routing",
      "domain": "general",
      "risk_level": "medium"
    }
  }'
```

## Expected Response

On paid success (`200`), response shape:

```json
{
  "subject_id": "agent_221",
  "trust_score": 67,
  "risk_level": "medium",
  "confidence": 0.79,
  "route": "degrade",
  "reasons": ["recent_validator_reversal"],
  "receipt": {
    "x402_verified": true,
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
    "payment_receipt_id": "xrc_...",
    "verifier_reference": "vr_...",
    "settlement_status": "provisional"
  }
}
```

## Why It Matters

- Enforces paid access for trust resolution (`402` when unpaid).
- Returns a verified trust decision in one call.
- Produces a receipt id you can audit in billing and settlement flows.

## Event Feed And Proof Artifacts

Generate launch artifacts:

```bash
npm run proof
```

Read recent payment events:

```bash
npm run event-feed
```
