# Release Cleanup Report

## Summary

Infopunks Trust Layer has been reduced to the Agentic.Market launch path:

- one paid trust endpoint: `POST /v1/resolve-trust`
- public launch metadata: `GET /health`, `GET /openapi.json`, `GET /.well-known/infopunks-trust-layer.json`
- x402 verification, receipts, billing ledger, idempotency, and request logging
- minimal War Room paid-call event feed
- focused testnet/mainnet smoke commands

## Removed

- Generated/local artifacts: `.next`, local SQLite DB files, `.DS_Store`, launch proof artifacts, nested duplicate repo, sandbox `.env`, sandbox `node_modules`.
- Public adapter routes not needed for launch: legacy trust alias, MCP JSON-RPC HTTP surface, old marketplace manifests, Bazaar/AI plugin endpoints, reputation/evidence demo routes, OpenAPI YAML route, root marketing route.
- Root package scripts outside the required launch set.

## Quarantined

Moved to `archive/pre-agentic-market-cleanup/`:

- old Next landing site and UI experiments
- simulator and examples
- broad docs/examples/framework notes
- old shell/proof/readiness scripts
- stale broad OpenAPI speccheck utility
- old marketplace listing artifacts
- non-resolve-trust adapter tool handlers
- old broad/prototype tests
- x402 buyer sandbox without `.env` or `node_modules`

## Production Risks Eliminated

- Production Render adapter config now points to Base mainnet (`eip155:8453`) and Base USDC.
- Production examples no longer contain Sepolia defaults.
- `ALLOW_TESTNET=false` and `ALLOW_RELAXED_PAYMENT=false` are explicit in production config.
- Public stale routes are absent from the adapter source.
- Metrics and x402 admin/reconciliation routes remain protected.
- No active `.env` files with secrets are present; only `.env.example` and `.env.production.example` remain.

## Verification

Commands run:

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

Results:

- `npm install`: passed; removed old frontend dependencies. Local Node warning only because this machine is Node v25 while repo targets Node 22.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 56 focused launch tests.
- `npm run build`: passed.
- `npm run readiness`: passed static readiness; live checks skipped because `PUBLIC_BASE_URL` is unset locally.
- smoke commands: executed and skipped live calls because signed payment JSON and `PUBLIC_BASE_URL` are not present locally. Use `SMOKE_REQUIRED=true` for launch validation.

## Manual Launch Steps

1. Set real production secrets in the deployment platform.
2. Set `PUBLIC_BASE_URL` and `MCP_ADAPTER_PUBLIC_URL` to the final HTTPS adapter URL.
3. Set `X402_PAY_TO` to the Base mainnet receiver wallet.
4. Provide facilitator credentials if required.
5. Run live smoke tests with real signed x402 payment payloads and `SMOKE_REQUIRED=true`.
6. Submit `https://<public-adapter-host>/.well-known/infopunks-trust-layer.json` to Agentic.Market.
