# Infopunks MCP Adapter

Public-facing MCP/x402 adapter in front of the Infopunks core HTTP API.

The adapter is intentionally thin:
- MCP tool transport + schema validation
- x402 proof/session verification
- anti-replay enforcement
- signed entitlement/session token validation
- identity mapping to internal Passports
- normalized machine-first envelopes

It does not compute trust/routing logic. The core API remains system of record.

## Transport

- `POST /mcp` JSON-RPC MCP endpoint
- `POST /trust-score` REST alias (HTTP 402 challenge semantics for paid trust resolution)
- `GET /agent-reputation/:id` REST alias
- `POST /verify-evidence` REST alias
- `GET /health` simple health alias
- `GET /healthz`
- `GET /marketplace/readiness`
- `GET /marketplace/manifest` (also at `/.well-known/agentic-marketplace.json`)
- `GET /metrics`
- `POST /x402/settlement/webhook`
- `POST /x402/reconcile`
- `GET /.well-known/x402-bazaar.json`
- `GET /.well-known/ai-plugin.json`

## Environment Variables

Core:
- `MCP_ADAPTER_TRANSPORT` (`http|stdio`, default `http`)
- `MCP_ADAPTER_HOST` (default `0.0.0.0`)
- `MCP_ADAPTER_PORT` (default `4021`)
- `MCP_ADAPTER_PUBLIC_URL` (required in non-local HTTP mode)
- `INFOPUNKS_CORE_BASE_URL` (default `http://127.0.0.1:4010`)
- `INFOPUNKS_INTERNAL_SERVICE_TOKEN` (required for production)
- `MCP_ADAPTER_LOG_LEVEL` (`debug|info|warn|error`, default `info`)

x402 verifier:
- `X402_VERIFIER_MODE` (`facilitator|strict|stub`, default `facilitator`)
- `X402_VERIFIER_URL` (default `https://x402.org/facilitator`)
- `X402_VERIFIER_API_KEY` (optional)
- `X402_VERIFIER_TIMEOUT_MS` (default `5000`)
- `X402_REQUIRED_DEFAULT` (`true|false`, default `true`)
- `INFOPUNKS_X402_SHARED_SECRET` (used by `strict` mode)

Replay/spend controls:
- `X402_REPLAY_STRICT` (`true|false`, default `true`)
- `X402_REPLAY_WINDOW_SECONDS` (default `900`)
- `INFOPUNKS_X402_DAILY_LIMIT_UNITS` (default `100`)
- `X402_ACCEPTED_ASSETS` (CSV, default `USDC`)
- `X402_SUPPORTED_NETWORKS` (CSV, default `eip155:84532`)
- `X402_PAYMENT_SCHEME` (default `exact`)
- `X402_PAYMENT_ASSET_ADDRESS` (default Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
- `X402_PAY_TO` (required receiver address when payments are enabled)
- `X402_PRICE_PER_UNIT_ATOMIC` (default `10000`)
- `X402_PAYMENT_TIMEOUT_SECONDS` (default `300`)
- `X402_EIP712_NAME` (default `USD Coin`)
- `X402_EIP712_VERSION` (default `2`)
- `X402_REQUIRE_PAYMENT_ASSET` (`true|false`, default `false`)
- `X402_REQUIRE_PAYMENT_NETWORK` (`true|false`, default `false`)

Durable state:
- `MCP_ADAPTER_STATE_STORE_DRIVER` (`sqlite|postgres`, default `sqlite`)
- `MCP_ADAPTER_STATE_DB_PATH` (default `services/mcp-adapter/.runtime/adapter-state.db`)
- `MCP_ADAPTER_STATE_STORE_DATABASE_URL` (required for postgres state store)
- `INFOPUNKS_MCP_IDENTITY_MAP_DRIVER` (`file|postgres`, default `file`)
- `INFOPUNKS_MCP_IDENTITY_MAP_PATH` (default `services/mcp-adapter/.runtime/external_identity_mappings.json`)
- `INFOPUNKS_MCP_IDENTITY_MAP_DATABASE_URL` (optional; defaults to state store database URL when postgres mapping is enabled)
- `MCP_ADAPTER_RATE_LIMIT_DRIVER` (`memory|postgres`, default `memory`)
- `MCP_ADAPTER_RATE_LIMIT_POSTGRES_URL` (optional; defaults to state store database URL when postgres rate limiting is enabled)
- `MCP_ADAPTER_MULTI_INSTANCE_MODE` (`true|false`, default `false`)

Settlement/reconciliation:
- `X402_SETTLEMENT_WEBHOOK_SECRET` (optional webhook auth)
- `X402_SETTLEMENT_WEBHOOK_HMAC_SECRET` (recommended webhook signature secret)
- `X402_SETTLEMENT_WEBHOOK_MAX_SKEW_SECONDS` (default `300`)
- `X402_RECONCILIATION_ENABLED` (`true|false`, default `true`)
- `X402_RECONCILIATION_INTERVAL_MS` (default `60000`)
- `X402_RECONCILIATION_LOCK_TTL_SECONDS` (default `90`, lease for distributed reconciliation worker lock)
- `MCP_ADAPTER_REQUIRE_WEBHOOK_AUTH_NON_LOCAL` (`true|false`, default `true`)
- `MCP_ADAPTER_ADMIN_TOKEN` (required for protected admin routes like `/x402/reconcile`; also protects `/metrics` unless public mode enabled)
- `MCP_ADAPTER_REQUIRE_ADMIN_TOKEN` (`true|false`, default `true`)
- `MCP_ADAPTER_METRICS_PUBLIC` (`true|false`, default `false`)
- `MCP_ADAPTER_MAX_BATCH_REQUESTS` (default `25`)
- `MCP_ADAPTER_REQUIRE_PUBLIC_URL_NON_LOCAL` (`true|false`, default `true`)

Entitlement/session token validation:
- `MCP_ENTITLEMENT_TOKEN_REQUIRED` (`true|false`, default `true`)
- `MCP_ENTITLEMENT_REQUIRE_FOR_PAID_TOOLS` (`true|false`, default `true`)
- `MCP_ENTITLEMENT_FALLBACK_ALLOW` (`true|false`, default `false`)
- `MCP_ENTITLEMENT_ISSUER`
- `MCP_ENTITLEMENT_AUDIENCE`
- `MCP_ENTITLEMENT_HS256_SECRET` (for HS256)
- `MCP_ENTITLEMENT_RS256_PUBLIC_KEY` (for RS256)
- `MCP_ENTITLEMENT_ALLOWED_ALGORITHMS` (CSV, default `RS256`)
- `MCP_ENTITLEMENT_CLOCK_SKEW_SECONDS` (default `30`)
- `MCP_ENTITLEMENT_MAX_TTL_SECONDS` (default `3600`)

Startup safety checks (fail-fast):
- In non-local environments, `X402_VERIFIER_MODE=stub` is blocked unless `X402_ALLOW_STUB_MODE=true`.
- In non-local HTTP mode, `MCP_ADAPTER_ADMIN_TOKEN` is required by default.
- In non-local HTTP mode, settlement webhook auth is required by default (`X402_SETTLEMENT_WEBHOOK_HMAC_SECRET` or `X402_SETTLEMENT_WEBHOOK_SECRET`).
- When x402 is required and verifier mode is `facilitator`, `X402_VERIFIER_URL` is mandatory.
- `MCP_ADAPTER_MULTI_INSTANCE_MODE=true` requires:
  - `MCP_ADAPTER_STATE_STORE_DRIVER=postgres`
  - `INFOPUNKS_MCP_IDENTITY_MAP_DRIVER=postgres`
  - `MCP_ADAPTER_RATE_LIMIT_DRIVER=postgres`

## MCP Tool List

- `get_passport`
- `resolve_trust`
- `select_validators`
- `select_executor`
- `evaluate_dispute`
- `get_trace_replay`
- `get_prompt_pack`
- `export_portability_bundle`
- `import_portability_bundle`
- `quote_risk`

## Core API Route Mapping

- `get_passport` -> `GET /v1/passports/{subjectId}`
- `resolve_trust` -> `POST /v1/trust/resolve`
- `select_validators` -> `POST /v1/routing/select-validator`
- `select_executor` -> `POST /v1/routing/select-executor`
- `evaluate_dispute` -> `POST /v1/disputes/evaluate`
- `get_trace_replay` -> `GET /v1/traces/{traceId}`
- `get_prompt_pack` -> `GET /v1/prompts/{name}`
- `export_portability_bundle` -> `POST /v1/portability/export`
- `import_portability_bundle` -> `POST /v1/portability/import`
- `quote_risk` -> `POST /v1/economic/risk-price`

REST aliases:
- `POST /trust-score` -> `resolve_trust` MCP tool -> `POST /v1/trust/resolve`
- `GET /agent-reputation/:id` -> `GET /v1/passports/{subjectId}` (+ optional `GET /v1/trust/{subjectId}/explain`)
- `POST /verify-evidence` -> `POST /v1/evidence`

`POST /trust-score` response shape:

```json
{
  "entity_id": "agent_221",
  "trust_score": 67,
  "risk_level": "medium",
  "confidence": 0.79,
  "last_updated": "2026-04-17T08:14:04Z",
  "signals": [
    {
      "name": "reason:recent_validator_reversal",
      "value": true,
      "weight": 0.2
    }
  ],
  "policy": {
    "route": "degrade",
    "reason": "recent_validator_reversal"
  }
}
```

## Response Envelopes

Success:

```json
{
  "result": { "...": "..." },
  "meta": {
    "tool": "resolve_trust",
    "adapter_trace_id": "mcp_trc_...",
    "internal_trace_id": "trc_...",
    "billed_units": 1,
    "payment_receipt_id": "xrc_..."
  }
}
```

Error:

```json
{
  "error": {
    "code": "PAYMENT_REPLAY_DETECTED",
    "message": "Payment proof/session replay detected.",
    "details": {},
    "retryable": false,
    "adapter_trace_id": "mcp_trc_..."
  }
}
```

## Local Run

```bash
npm start
```

For local payment bypass only:

```bash
X402_VERIFIER_MODE=stub npm start
```

Security smoke checks:

```bash
./scripts/mcp-adapter-security-smoke.sh http://127.0.0.1:4021
```

Marketplace readiness proof:

```bash
./scripts/agentic-market-readiness.sh https://mcp.infopunks.ai
```

If you have live facilitator credentials and entitlement/payment context:

```bash
MCP_ENTITLEMENT_TOKEN="<jwt>" \
FACILITATOR_PAYMENT_JSON='{"rail":"x402","payer":"agent_router","units_authorized":1,"nonce":"n_123","proof_id":"pf_123","reference":"rcpt_123"}' \
FACILITATOR_CALL_SUBJECT_ID="agent_221" \
./scripts/agentic-market-readiness.sh https://mcp.infopunks.ai
```

Operator checklist proof (includes paid call, receipt creation, replay rejection, reconciliation):

```bash
MCP_ENTITLEMENT_TOKEN="<jwt>" \
FACILITATOR_PAYMENT_JSON='{"rail":"x402","asset":"USDC","network":"eip155:84532","payer":"agent_router","units_authorized":2,"nonce":"n_123","proof_id":"pf_123","session_id":"sess_123","reference":"rcpt_123"}' \
MCP_ADAPTER_ADMIN_TOKEN="<admin_token>" \
X402_SETTLEMENT_WEBHOOK_HMAC_SECRET="<webhook_hmac_secret>" \
./scripts/operator-production-checklist.sh https://mcp.infopunks.ai
```

Machine-readable adapter contract:
- `services/mcp-adapter/openapi.yaml`
