# Agentic.Market Listing Notes

Infopunks Trust Layer exposes one paid trust primitive for Agentic.Market: `POST /v1/resolve-trust`.

## Public Endpoints

| Method | Path | Purpose | Payment |
|---|---|---|---|
| `GET` | `/health` | Liveness check for deploy/listing probes | none |
| `GET` | `/.well-known/infopunks-trust-layer.json` | Infopunks discovery metadata | none |
| `GET` | `/openapi.json` | OpenAPI JSON for the public HTTP surface | none |
| `POST` | `/v1/resolve-trust` | Resolve trust for an agent/subject | x402 required in production |

## Mainnet Payment Configuration

Production Base mainnet config must be explicit:

```bash
NODE_ENV=production
PUBLIC_BASE_URL=https://infopunks-x402-adapter-cdp-staging.onrender.com
MCP_ADAPTER_PUBLIC_URL=https://infopunks-x402-adapter-cdp-staging.onrender.com
X402_NETWORK=base
X402_ASSET=USDC
X402_PRICE=0.01
X402_PRICE_PER_UNIT_ATOMIC=10000
X402_PAY_TO=0x<base-mainnet-receiver>
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
X402_EIP712_NAME="USD Coin"
ALLOW_TESTNET=false
ALLOW_RELAXED_PAYMENT=false
```

The Base mainnet USDC asset is `0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913`. Base Sepolia is only for testnet smoke/proof runs and must not appear in production config or manifests.

## Example Unpaid Request

```bash
curl -i -X POST "$PUBLIC_BASE_URL/v1/resolve-trust" \
  -H 'content-type: application/json' \
  --data '{
    "subject_id":"agent_221",
    "context":{
      "task_type":"agentic.market.execution",
      "domain":"marketplace",
      "risk_level":"medium"
    }
  }'
```

Unpaid production calls return `402` with an x402 challenge in the `PAYMENT-REQUIRED` response header.

## Example Paid Response

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
    "asset": "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
    "payment_receipt_id": "xrc_...",
    "verifier_reference": "...",
    "settlement_status": "provisional"
  }
}
```

## Integration Notes

- Use `/v1/resolve-trust`; no other public paid endpoint is required for launch.
- Preserve the exact `PAYMENT-REQUIRED` challenge values when constructing the paid retry.
- Send the paid retry with either an `X-PAYMENT` header containing the base64 x402 payload or a `payment` object containing `paymentPayload` and `paymentRequirements`.
- Include `x-request-id` for reconciliation-friendly logs. The server returns the same request ID header.
- Successful paid calls write a payment receipt, request log, War Room event if enabled, and billing ledger entry.

## Smoke Tests

Testnet:

```bash
PUBLIC_BASE_URL=https://infopunks-x402-adapter-cdp-staging.onrender.com \
TESTNET_X402_PAYMENT_JSON='<testnet payment json>' \
SMOKE_X402_NETWORK=testnet \
npm run smoke:x402:cdp
```

Mainnet:

```bash
PUBLIC_BASE_URL=https://infopunks-x402-adapter-cdp-staging.onrender.com \
MAINNET_X402_PAYMENT_JSON='<mainnet payment json>' \
SMOKE_X402_NETWORK=mainnet \
npm run smoke:x402:cdp
```

Run three paid mainnet calls with distinct payment payloads/nonces:

```bash
for i in 1 2 3; do
  PUBLIC_BASE_URL=https://infopunks-x402-adapter-cdp-staging.onrender.com \
  SMOKE_REQUEST_ID="mainnet-paid-${i}" \
  MAINNET_X402_PAYMENT_JSON="$(cat artifacts/mainnet-payment-${i}.json)" \
  SMOKE_X402_NETWORK=mainnet \
  SMOKE_REQUIRED=true \
  npm run smoke:x402:cdp
done
```
