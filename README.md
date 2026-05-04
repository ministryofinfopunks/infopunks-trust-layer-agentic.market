# Infopunks Trust Layer

An x402-paid trust resolution primitive for agents on Base.

## Live Service

Base URL:

```text
https://infopunks-x402-adapter-cdp-staging.onrender.com
```

Health:

```text
GET /health
```

Public event feed:

```text
GET /v1/events/recent
```

## Paid Resources

The Trust Layer exposes one paid resource:

```text
POST /v1/resolve-trust
```

Agents call this before routing work, capital, validation, execution, or payment. The response returns a trust score, route decision, confidence, reasons, and an x402-backed public application receipt.

## Proof

Proof index:

```text
https://infopunks-x402-adapter-cdp-staging.onrender.com/proof
```

Receipt proof pages:

```text
https://infopunks-x402-adapter-cdp-staging.onrender.com/proof/{receipt_id}
```

Fresh proof page:

```text
https://infopunks-x402-adapter-cdp-staging.onrender.com/proof/xrc_41855125-159b-4563-82a9-91e05bdfe6cb
```

## Receipts

Public receipt endpoint:

```text
GET /receipts/{receipt_id}
```

Fresh receipt:

```text
https://infopunks-x402-adapter-cdp-staging.onrender.com/receipts/xrc_41855125-159b-4563-82a9-91e05bdfe6cb
```

Trust Layer receipts expose public application-level metadata: receipt id, final status, x402 verification status, facilitator provider, network, asset, payTo, resource, result hash, proof URL, settlement status when available, `bazaar_metadata_status`, `external_bazaar_acceptance`, and Bazaar extension diagnostics.

## x402 / Base Configuration

Current public configuration:

```text
Facilitator: CDP x402
Network: Base mainnet
Network CAIP-2: eip155:8453
Asset: USDC
Payment scheme: exact
Paid resource: /v1/resolve-trust
```

The service returns a `402 Payment Required` challenge when `/v1/resolve-trust` is called without a valid x402 payment header. A successful paid call returns `200` and includes a public application receipt.

## Discovery

Infopunks discovery manifest:

```text
https://infopunks-x402-adapter-cdp-staging.onrender.com/.well-known/infopunks-trust-layer.json
```

Trust Layer includes Bazaar metadata and is discovery-ready. External Bazaar acceptance is pending confirmation.

## OpenAPI

OpenAPI contract:

```text
https://infopunks-x402-adapter-cdp-staging.onrender.com/openapi.json
```

The OpenAPI document includes the public contract for:

```text
/v1/resolve-trust
/receipts/{receipt_id}
/v1/events/recent
/proof
```

## Example Paid Call

Example paid request shape:

```bash
curl -i 'https://infopunks-x402-adapter-cdp-staging.onrender.com/v1/resolve-trust' \
  -X POST \
  -H 'content-type: application/json' \
  -H 'x-payment: <x402-payment-payload>' \
  -d '{
    "subject_id": "agent_221",
    "context": {
      "task_type": "marketplace_routing",
      "domain": "general",
      "risk_level": "medium"
    }
  }'
```

Expected paid result:

```text
HTTP 200
```

The response includes trust output and a receipt object.

## Local Development

Install dependencies:

```bash
npm install
```

Run the service locally:

```bash
npm run dev
```

Build and test:

```bash
npm run build
npm test
```

Run readiness and x402 smoke checks:

```bash
npm run readiness
npm run smoke:x402:cdp
npm run audit:bazaar
```

Local development may use local or mock verifier settings. Public proof deployments should use CDP x402 on Base mainnet.

## Environment Variables

Core runtime:

```text
INFOPUNKS_ENVIRONMENT
INFOPUNKS_CORE_BASE_URL
INFOPUNKS_BACKEND_URL
MCP_ADAPTER_PUBLIC_URL
MCP_ADAPTER_PORT
MCP_ADAPTER_HOST
MCP_ADAPTER_ADMIN_TOKEN
INFOPUNKS_INTERNAL_SERVICE_TOKEN
```

x402 and Base configuration:

```text
X402_FACILITATOR_PROVIDER
X402_NETWORK
X402_ASSET
X402_PRICE_USD
X402_PRICE
ALLOW_TESTNET
CDP_API_KEY_ID
CDP_API_KEY_SECRET
```

Settlement and storage configuration:

```text
X402_SETTLEMENT_WEBHOOK_HMAC_SECRET
X402_SETTLEMENT_WEBHOOK_SECRET
INFOPUNKS_MCP_IDENTITY_MAP_DRIVER
INFOPUNKS_MCP_IDENTITY_MAP_DATABASE_URL
MCP_ADAPTER_RATE_LIMIT_DRIVER
MCP_ADAPTER_RATE_LIMIT_POSTGRES_URL
```

## Status

Phase 1: Trust + Proof is confirmed as a v0 mainnet proof.

Fresh paid receipt:

`xrc_41855125-159b-4563-82a9-91e05bdfe6cb`

The service verifies x402 payment through CDP on Base mainnet and returns a public application receipt for `/v1/resolve-trust`.

Note: current Trust Layer receipts are application-level public receipts with settlement marked provisional unless a transaction hash is available.
