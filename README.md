# Infopunks Trust Layer

Clean x402 trust-resolution service for Agentic.Market listing.

## Launch Surface

One paid endpoint:

- `POST /v1/resolve-trust`

Public metadata and health:

- `GET /health`
- `GET /openapi.json`
- `GET /.well-known/infopunks-trust-layer.json`

Protected payment operations:

- `POST /x402/reconcile`
- `POST /x402/settlement/webhook`
- `GET /metrics` when admin token is provided

## Commands

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run readiness
npm run smoke:x402:testnet
npm run smoke:x402:mainnet
```

Smoke scripts skip live paid calls unless `PUBLIC_BASE_URL` and a matching payment JSON are provided. Set `SMOKE_REQUIRED=true` in launch validation to fail instead of skip.

## Deploy

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run readiness
```

Start the adapter:

```bash
npm start
```

For the internal core API used by the adapter, Render starts:

```bash
node apps/api/server.mjs
```

## Production Config

Use `.env.production.example` as the Base mainnet template. Production must use HTTPS public URLs, Base mainnet USDC, facilitator verification, and `ALLOW_TESTNET=false` / `ALLOW_RELAXED_PAYMENT=false`.

See `docs/agentic-market.md` for the listing packet and validation commands.
