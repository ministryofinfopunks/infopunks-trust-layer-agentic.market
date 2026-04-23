# Infopunks Trust Layer V1

Infopunks Trust Layer V1 is a deterministic trust resolution and routing substrate for multi-agent systems. It ships as a package, SDK, API, and event rail. The center of gravity is Passport, Evidence, Trust, Routing, and live events.

## Repo Layout

- `apps/api`: HTTP control plane for Passport, Evidence, Trust, Routing, Event Rail, Trace/Replay, metrics, and demo simulation.
- `apps/site`: homepage plus the React War Room surface.
- `apps/war-room`: standalone operator-facing War Room surface.
- `apps/simulator`: CLI scenario runner that creates visible trust movement in seconds.
- `services/mcp-adapter`: Agentic.Market-ready MCP adapter with identity bridge and x402-compatible payment gating.
- `packages/trust-engine`: deterministic snapshot and score computation logic.
- `packages/trust-sdk`: the single installable primitive, published as `@infopunks/trust-sdk`.
- `docs`: quickstart, API overview, concepts, framework examples, builder checklists, and end-to-end example material.
- `openapi.yaml`: source of truth for the public control-plane contract.

## Quick Start

```bash
npm install
npm run dev
```

`npm run dev` boots the API on a fresh local SQLite database, seeds demo movement automatically, and prints the local URLs plus development API keys.

If you want the control plane only:

```bash
npm start
```

For the UI workspace only:

```bash
npm run site:dev
```

For the MCP adapter:

```bash
npm run mcp:adapter
```

For a production-style UI build:

```bash
npm run site:build
```

## Install Surface

```ts
import { Infopunks } from "@infopunks/trust-sdk";
```

Default local API key:

```text
dev-infopunks-key
```

Override it with `INFOPUNKS_API_KEY` when needed.

## Environment

- `INFOPUNKS_BASE_URL`: control-plane base URL for local tools and the War Room.
- `INFOPUNKS_DB_PATH`: SQLite path for the API process.
- `INFOPUNKS_API_KEY`: root development API key.
- `INFOPUNKS_READ_API_KEY`: read-only development API key used by the War Room.
- `PORT`: API listen port, default `4010`.

## Generated Artifacts

- `apps/site/.next`
- `data/local`
- SQLite WAL and shm files

These are local-only artifacts and should not be committed.

## Quality Gates

```bash
npm run ci
```

## Deployment Handoff

For release and ops handoff, use:

- `docs/deployment-handoff.md`

## Single Payable Endpoint (x402)

Public commercial endpoint (via MCP adapter):

- `POST /trust-score` (payable)

Health endpoint:

- `GET /health`

Trust-score response shape:

```json
{
  "entity_id": "string",
  "trust_score": 0,
  "risk_level": "low|medium|high|critical",
  "confidence": 0,
  "last_updated": "ISO-8601 timestamp",
  "signals": [
    {
      "name": "string",
      "value": "string|number|boolean",
      "weight": 0
    }
  ],
  "policy": {
    "route": "allow|degrade|quarantine|block",
    "reason": "string"
  }
}
```

## Local Run (Safe Test First)

1. Start core API:

```bash
npm start
```

2. Start MCP/x402 adapter (strict mode safe test):

```bash
INFOPUNKS_ENVIRONMENT=local \
MCP_ADAPTER_TRANSPORT=http \
MCP_ADAPTER_HOST=0.0.0.0 \
MCP_ADAPTER_PORT=4021 \
INFOPUNKS_CORE_BASE_URL=http://127.0.0.1:4010 \
INFOPUNKS_INTERNAL_SERVICE_TOKEN=dev-infopunks-key \
X402_REQUIRED_DEFAULT=true \
X402_VERIFIER_MODE=strict \
INFOPUNKS_X402_SHARED_SECRET=replace-for-local-testing \
MCP_ENTITLEMENT_TOKEN_REQUIRED=false \
MCP_ENTITLEMENT_REQUIRE_FOR_PAID_TOOLS=false \
MCP_ENTITLEMENT_FALLBACK_ALLOW=true \
npm run mcp:adapter
```

3. Check health:

```bash
curl -s http://127.0.0.1:4021/health | jq
```

## Unpaid vs Paid Test Calls

Unpaid request (expect HTTP `402`):

```bash
curl -i -X POST http://127.0.0.1:4021/trust-score \
  -H 'content-type: application/json' \
  -d '{
    "entity_id":"agent_221",
    "context":{"task_type":"market_analysis","domain":"crypto","risk_level":"high"}
  }'
```

Paid request (strict local test equivalent):

```bash
PROOF=$(node -e 'const c=require("crypto");const payer="agent_router";const nonce="nonce_1";const units=1;process.stdout.write(c.createHmac("sha256","replace-for-local-testing").update(`${payer}:${nonce}:${units}`).digest("hex"));')

curl -i -X POST http://127.0.0.1:4021/trust-score \
  -H 'content-type: application/json' \
  -d "{
    \"entity_id\":\"agent_221\",
    \"context\":{\"task_type\":\"market_analysis\",\"domain\":\"crypto\",\"risk_level\":\"high\"},
    \"payment\":{
      \"rail\":\"x402\",
      \"asset\":\"USDC\",
      \"network\":\"base\",
      \"payer\":\"agent_router\",
      \"units_authorized\":1,
      \"nonce\":\"nonce_1\",
      \"proof\":\"${PROOF}\",
      \"proof_id\":\"proof_1\"
    }
  }"
```

## Public Deployment Path

Deployment target selected: **Render** (backend-first, fastest for two-node services: core API + public x402 adapter).

Why:
- repo already has Node service entrypoints
- no framework migration required
- simple managed Postgres + environment secret injection
- clean separation: private core trust API, public payable adapter

Use:
- `render.yaml` for service topology
- `.env.example` for required secrets/vars

## How this gets discovered on Agentic Market / x402 Bazaar

Expose adapter publicly with:
- `GET /.well-known/x402-bazaar.json`
- `GET /.well-known/agentic-marketplace.json`
- `POST /trust-score` with HTTP `402` challenge semantics and x402 metadata headers

Discovery/indexing prerequisites:
- `MCP_ADAPTER_PUBLIC_URL` set to a real public domain
- facilitator/verifier mode active (`X402_VERIFIER_MODE=facilitator`)
- successful paid calls producing receipt-linked activity
- no localhost URLs in discovery manifests

## P2 Surfaces

- Cost-aware calls: `POST /v1/budget/quote`, plus `response_cost` and `budget_hints` on machine-facing JSON resources.
- Portability bundle: `POST /v1/portability/export` and `POST /v1/portability/import` for signed trust carriage across networks.
- Economic hooks: `POST /v1/economic/escrow-quote`, `POST /v1/economic/risk-price`, and `POST /v1/economic/attestation-bundle`.
- Builder doctrine: see `docs/frameworks/openai-agents-sdk.md`, `docs/frameworks/langchain.md`, `docs/frameworks/claude-codex.md`, `docs/builders/add-trust-to-your-swarm-in-5-minutes.md`, and `docs/builders/trust-layer-checklist.md`.
