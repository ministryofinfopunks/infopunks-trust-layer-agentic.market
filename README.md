# Infopunks Trust Layer

Infopunks Trust Layer is one paid trust primitive for Agentic.Market.

Agents call it before routing work, capital, validation, execution, or payment:

`POST /v1/resolve-trust`

The response returns a trust score, route, reasons, confidence, and x402 receipt. It is a developer-native preflight check: pay once, resolve trust, then decide whether to allow, degrade, or block the next action.

## What It Is

Single paid endpoint:
- `POST /v1/resolve-trust`

Public endpoints:

- `GET /health`
- `GET /openapi.json`
- `GET /.well-known/infopunks-trust-layer.json`
- `GET /v1/events/recent`

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

Hosted checks:

```bash
curl https://YOUR_PUBLIC_URL/health
curl https://YOUR_PUBLIC_URL/.well-known/infopunks-trust-layer.json
curl https://YOUR_PUBLIC_URL/openapi.json
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

Generate public testnet proof against deployed URL:

```bash
PUBLIC_BASE_URL=https://<your-render-url> \
npm run smoke:public:testnet

PUBLIC_BASE_URL=https://<your-render-url> \
X_PAYMENT_B64=<base64-x402-payment-payload> \
npm run smoke:public:testnet

PUBLIC_BASE_URL=https://<your-render-url> \
X_PAYMENT_B64=<base64-x402-payment-payload> \
npm run proof:public:testnet
```

Read recent payment events:

```bash
npm run event-feed
```

## Environment Matrix

| Environment | Network | Asset | Verifier | Use |
|---|---|---|---|---|
| local | Base Sepolia/mock | USDC | local facilitator | CI/dev |
| testnet | Base Sepolia | USDC | real facilitator | controlled launch |
| production | Base mainnet | USDC | real facilitator | public launch |
