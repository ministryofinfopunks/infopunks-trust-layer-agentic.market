# Agentic.Market Release Cleanup Audit

Generated before deletion/quarantine on branch `release/agentic-market-cleanup`.

## KEEP

Core Agentic.Market launch path:
- `services/mcp-adapter/src/index.mjs`
- `services/mcp-adapter/src/transport/http-server.mjs`
- `services/mcp-adapter/src/transport/mcp-server.mjs` as internal executor for `resolve_trust`
- `services/mcp-adapter/src/tools/resolve-trust.mjs`
- `services/mcp-adapter/src/payments/*` required for x402 verification, receipts, reconciliation, idempotency, and billing
- `services/mcp-adapter/src/storage/*` required for receipts, billing ledger, request log, War Room paid-call events, and idempotency
- `services/mcp-adapter/src/config/env.mjs`, `pricing.mjs`, `x402-token-metadata.mjs`, `tool-registry.mjs`
- `services/mcp-adapter/src/client/infopunks-api-client.mjs` and upstream resilience for core trust API calls
- `services/mcp-adapter/src/identity/*`, `middleware/*`, `schemas/*`, `observability/*`, `security/*`
- `apps/api/*` as the internal core trust API used by adapter `/v1/resolve-trust`
- `packages/trust-engine`, `packages/schema`, `packages/event-contracts`, `packages/trust-sdk` where used by core API/tests
- `GET /health`
- `GET /openapi.json`
- `GET /.well-known/infopunks-trust-layer.json`
- `POST /v1/resolve-trust`
- `GET /api/war-room/events` and static `/war-room` assets only as proof-of-life paid-call logging if enabled
- `POST /x402/settlement/webhook` and `POST /x402/reconcile` only as authenticated/admin payment operations
- `scripts/mainnet-smoke.mjs`
- testnet smoke script to be consolidated from `scripts/proof/*`
- `scripts/lint.mjs`, `scripts/typecheck.mjs`, OpenAPI generation/check helpers required by build/readiness
- `docs/agentic-market.md`
- `.env.example` and `.env.production.example` with no secrets and separated testnet/mainnet guidance
- `render.yaml`, `package.json`, `package-lock.json`
- focused launch tests for health, listing readiness, production hardening, x402, and resolve-trust/core smoke

## REMOVE

Clearly generated/local/unsafe for production:
- `.DS_Store` files
- `apps/site/.next/`
- `data/*.db`, `data/local/*.db*`
- `services/mcp-adapter/.runtime/*.db`
- `artifacts/launch-proof/*.json`, `*.md`, `*.log` launch run artifacts
- nested duplicate repo directory `Infopunks Trust Layer Agentic.Market/`
- `x402-buyer-test/node_modules/`
- `x402-buyer-test/.env`

Public adapter routes to remove for a boring launch surface:
- legacy `POST /trust-score`
- `GET /agent-reputation/{id}`
- `POST /verify-evidence`
- public `POST /mcp`
- `GET /.well-known/x402-bazaar.json`
- `GET /.well-known/agentic-marketplace.json`
- `GET /.well-known/ai-plugin.json`
- `GET /marketplace/readiness`
- `GET /marketplace/manifest`
- `GET /bazaar/discovery`
- `GET /openapi.yaml`
- unauthenticated root marketing endpoint `/`
- public `/metrics` unless explicitly admin-protected

Root package scripts to remove/simplify:
- `site:*`, `local:up`, `clean`, `contract:generate`, `sim:demo`, `speccheck`, `ci`, `seed*`, `bootstrap:*`, `hardening:sim`, `demo:*`, `proof:*`, `replay`, `mcp:adapter`

## QUARANTINE

Useful history/prototypes not required for one paid Agentic.Market endpoint:
- `apps/site/` landing/old UI experiment
- `apps/simulator/`
- `examples/`
- `docs/api`, `docs/builders`, `docs/concepts`, `docs/examples`, `docs/frameworks`, `docs/quickstart`
- `docs/deployment-handoff.md`, `docs/first-paid-*`
- `services/mcp-adapter/LISTING.md`, `agentic-marketplace.json`, `skills.json`, `.well-known/ai-plugin.json`
- non-resolve-trust adapter tools: validator/executor selection, disputes, trace replay, prompt pack, portability, quote risk
- old readiness/checklist shell scripts that exercise MCP/marketplace experiment routes
- broad prototype tests unrelated to launch surface
- `x402-buyer-test/` sandbox after removing `.env` and `node_modules`

## UNSURE

Keep unless cleanup proves they are unused or unsafe:
- `packages/prompt-pack` may only support old prompt demos; quarantine if imports disappear after tool trimming
- Core API routes beyond `/healthz`, `/v1/passports`, and `/v1/trust/resolve`; they are not public launch endpoints but may support the internal resolver/tests
- Next landing site if marketing deployment still uses it; not required by Agentic.Market x402 listing
- War Room UI: keep only if paid-call event proof is required; otherwise leave archived copy

## Required Final Public Surface

Adapter public unauthenticated:
- `GET /health`
- `GET /openapi.json`
- `GET /.well-known/infopunks-trust-layer.json`
- `POST /v1/resolve-trust` with x402 402/200 semantics

Adapter protected/admin:
- `POST /x402/reconcile`
- `POST /x402/settlement/webhook`
- `GET /metrics` only if token-protected or disabled from public use

Smoke/readiness:
- `npm run readiness`
- `npm run smoke:x402:testnet`
- `npm run smoke:x402:mainnet`
