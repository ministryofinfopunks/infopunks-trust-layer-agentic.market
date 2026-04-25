# Agentic.Market Listing Notes

Infopunks Trust Layer exposes a single paid trust-resolution endpoint for Agentic.Market clients. The existing MCP and legacy `/trust-score` paths remain available; the listing-facing HTTP path is `/v1/resolve-trust`.

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
PUBLIC_BASE_URL=https://<public-adapter-host>
X402_NETWORK=base
X402_ASSET=USDC
X402_PRICE_USD=0.01
X402_PRICE_PER_UNIT_ATOMIC=10000
X402_PAY_TO=0x<base-mainnet-receiver>
X402_FACILITATOR_URL=https://x402.org/facilitator
ALLOW_TESTNET=false
ALLOW_RELAXED_PAYMENT=false
```

The Base mainnet USDC asset is `0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913`. Base Sepolia remains supported for proof/testing only and must not be present in production mainnet config.

## Example Request

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

- Use `/v1/resolve-trust` for Agentic.Market HTTP integrations.
- Use `/mcp` when the client is an MCP JSON-RPC tool caller.
- Preserve the exact `PAYMENT-REQUIRED` challenge values when constructing the paid retry.
- Send the paid retry with either an `X-PAYMENT` header containing the base64 x402 payload or a `payment` object containing `paymentPayload` and `paymentRequirements`.
- Include `x-request-id` for reconciliation-friendly logs. The server returns the same request ID header.
- Successful paid calls write a payment receipt, request log, War Room event, and billing ledger entry.

## Mainnet Smoke Test

```bash
PUBLIC_BASE_URL=https://<public-adapter-host> \
MAINNET_X402_PAYMENT_JSON='<wallet/facilitator-produced payment json>' \
npm run smoke:mainnet
```

Run three paid calls with distinct payment payloads/nonces:

```bash
for i in 1 2 3; do
  PUBLIC_BASE_URL=https://<public-adapter-host> \
  SMOKE_REQUEST_ID="mainnet-paid-${i}" \
  MAINNET_X402_PAYMENT_JSON="$(cat artifacts/mainnet-payment-${i}.json)" \
  npm run smoke:mainnet
done
```
