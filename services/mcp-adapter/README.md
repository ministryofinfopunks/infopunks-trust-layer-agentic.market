# Infopunks Trust Layer Adapter

Minimal x402-gated HTTP adapter for Agentic.Market launch.

## Public Surface

- `GET /health`
- `GET /openapi.json`
- `GET /.well-known/infopunks-trust-layer.json`
- `POST /v1/resolve-trust`

`POST /v1/resolve-trust` is x402-gated when `X402_REQUIRED_DEFAULT=true`. Unpaid calls return `402` with a `PAYMENT-REQUIRED` challenge. Paid calls return the stable Agentic.Market response shape:

```json
{
  "subject_id": "agent_221",
  "trust_score": 82,
  "risk_level": "low",
  "confidence": 0.91,
  "route": "allow",
  "reasons": ["policy_default"],
  "receipt": {
    "x402_verified": true,
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913"
  }
}
```

## Protected Operations

- `POST /x402/reconcile` requires `MCP_ADAPTER_ADMIN_TOKEN` when admin protection is enabled.
- `POST /x402/settlement/webhook` requires HMAC or webhook secret config.
- `GET /metrics` is token-protected unless `MCP_ADAPTER_METRICS_PUBLIC=true`.

## Production Safety

Production boot fails unless Base mainnet x402 config is explicit:

```bash
NODE_ENV=production
PUBLIC_BASE_URL=https://<public-adapter-host>
X402_NETWORK=base
X402_ASSET=USDC
X402_PRICE_USD=0.01
X402_PAY_TO=0x<base-mainnet-receiver>
X402_FACILITATOR_URL=https://x402.org/facilitator
ALLOW_TESTNET=false
ALLOW_RELAXED_PAYMENT=false
```

See [Agentic.Market listing notes](../../docs/agentic-market.md).
