# Deployment Handoff Checklist

This checklist is the final operator handoff for deploying Infopunks Trust Layer + MCP adapter.

## 1) System Topology

- Core API: `apps/api/server.mjs` (port `4010` by default)
- Marketing + App UI: `apps/site` (Next.js, port `3000` by default)
- War Room (core-hosted): `GET /war-room` from core API
- Simulator CLI: `apps/simulator/run.mjs`
- MCP/x402 adapter: `services/mcp-adapter/src/index.mjs` (port `4021` by default)

## 2) Required Environment Variables

### Core API (required for production)

- `PORT`
- `INFOPUNKS_DB_PATH`
- `INFOPUNKS_API_KEY`
- `INFOPUNKS_ENVIRONMENT`

### Core API (recommended)

- `INFOPUNKS_API_KEYS_JSON`
- `INFOPUNKS_RATE_LIMITS_JSON`
- `INFOPUNKS_PORTABILITY_SIGNING_KEY`
- `INFOPUNKS_SSE_MAX_STREAMS_PER_KEY`
- `INFOPUNKS_WEBHOOK_RETRY_BASE_MS`

### Site (required)

- `INFOPUNKS_API_BASE` (public/reachable URL to core API)

### MCP Adapter (required for guarded pilot)

- `MCP_ADAPTER_TRANSPORT=http`
- `MCP_ADAPTER_HOST`
- `MCP_ADAPTER_PORT`
- `MCP_ADAPTER_PUBLIC_URL`
- `INFOPUNKS_CORE_BASE_URL`
- `INFOPUNKS_INTERNAL_SERVICE_TOKEN`
- `INFOPUNKS_ENVIRONMENT`
- `MCP_ADAPTER_ADMIN_TOKEN`
- `X402_SETTLEMENT_WEBHOOK_HMAC_SECRET` (or `X402_SETTLEMENT_WEBHOOK_SECRET`)

### MCP Adapter x402 (required)

- `X402_REQUIRED_DEFAULT=true`
- `X402_VERIFIER_MODE=facilitator` (production) or `strict` (guarded/local)
- `X402_VERIFIER_URL=https://x402.org/facilitator`
- `X402_VERIFIER_API_KEY` (if facilitator requires auth)
- `X402_SUPPORTED_NETWORKS=eip155:84532`
- `X402_PAYMENT_SCHEME=exact`
- `X402_PAYMENT_ASSET_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- `X402_PAY_TO=<your_base_sepolia_receiver_address>`
- `X402_PRICE_PER_UNIT_ATOMIC=10000`

### MCP Adapter entitlement/session (production recommended)

- `MCP_ENTITLEMENT_TOKEN_REQUIRED=true`
- `MCP_ENTITLEMENT_ISSUER`
- `MCP_ENTITLEMENT_AUDIENCE`
- `MCP_ENTITLEMENT_ALLOWED_ALGORITHMS` (prefer `RS256`)
- `MCP_ENTITLEMENT_RS256_PUBLIC_KEY` (for `RS256`)

### MCP Adapter multi-instance production (required if `MCP_ADAPTER_MULTI_INSTANCE_MODE=true`)

- `MCP_ADAPTER_STATE_STORE_DRIVER=postgres`
- `MCP_ADAPTER_STATE_STORE_DATABASE_URL`
- `INFOPUNKS_MCP_IDENTITY_MAP_DRIVER=postgres`
- `INFOPUNKS_MCP_IDENTITY_MAP_DATABASE_URL` (or shared state DB URL)
- `MCP_ADAPTER_RATE_LIMIT_DRIVER=postgres`
- `MCP_ADAPTER_RATE_LIMIT_POSTGRES_URL` (or shared state DB URL)

## 3) Build + Start Commands

### Install

```bash
npm install
```

### Validate

```bash
npm run lint
npm test
npm run build
```

### Core API

```bash
npm start
```

### Site

```bash
npm run site:start
```

### MCP Adapter

```bash
npm run mcp:adapter
```

## 4) Mandatory Post-Deploy Checks

### Core API

- `GET /healthz` returns `200`
- `GET /war-room` renders
- `GET /v1/war-room/state` returns authenticated state payload

### Site

- `/` renders
- `/war-room` renders
- No broken API rewrites to private/local hosts

### MCP Adapter

- `GET /healthz`
- `GET /marketplace/readiness`
- `GET /.well-known/x402-bazaar.json`
- `GET /.well-known/agentic-marketplace.json`
- `POST /mcp` `tools/list` works
- Paid tool call requires entitlement/payment
- `/x402/reconcile` unauthorized without admin token
- `/x402/settlement/webhook` rejects unsigned calls

### Scripts

- `scripts/mcp-adapter-security-smoke.sh <base_url>`
- `scripts/agentic-market-readiness.sh <base_url>`

## 5) Production Go/No-Go Gates

Go only if all are true:

- Core API, site, MCP adapter health checks pass
- MCP paid tool call path returns billed metadata (`payment_receipt_id`)
- No stub verifier mode in non-local
- Admin token + webhook auth configured
- Public URL configured and reflected in discovery manifests
- Shared durable backend configured for multi-instance mode

No-Go if any are false:

- Missing verifier URL/credentials in facilitator mode
- Missing admin token or webhook auth in non-local HTTP mode
- Local-only state/rate-limit backends used in declared multi-instance deployment
