# First Paid Trust-Resolution Call (x402 Testnet)

This is the fastest reproducible path for the first successful paid trust-score request.

## 1) Prerequisites

- Core API deployed and reachable (for example `https://infopunks-core-api.onrender.com`)
- MCP adapter deployed and reachable (for example `https://infopunks-x402-adapter.onrender.com`)
- Adapter configured for Base Sepolia:
  - `X402_SUPPORTED_NETWORKS=eip155:84532`
  - `X402_PAYMENT_ASSET_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  - `X402_EIP712_NAME=USDC`
  - `X402_VERIFIER_URL=https://x402.org/facilitator`
  - `X402_PAY_TO=<your Base Sepolia receiver>`

## 2) Bootstrap a Subject in Core API

Register a subject/passport so paid trust calls do not fail with `UNKNOWN_SUBJECT`.

```bash
npm run bootstrap:subject -- \
  --subject-id agent_001 \
  --base-url https://infopunks-core-api.onrender.com \
  --api-key <core_api_key>
```

## 3) Run the x402 Buyer Test

From `x402-buyer-test/`:

```bash
node test-x402.mjs
```

Expected success shape:

- `Status: 200`
- response body includes:
  - `entity_id`
  - `trust_score`
  - `trust_state`
  - `trust_vector`
  - `risk_level`
  - `confidence`
  - `policy`

## 4) Quick Failure Triage

- `402` + missing `PAYMENT-REQUIRED`: seller challenge regression in adapter
- `PAYMENT_VERIFICATION_FAILED`: check network/asset metadata and facilitator settings
- `UPSTREAM_UNAVAILABLE`: check `INFOPUNKS_CORE_BASE_URL` and non-local localhost fallback protections
- `401 Missing or invalid API key`: check adapter->core token wiring (`Authorization: Bearer ...`)
- `UNKNOWN_SUBJECT`: rerun subject bootstrap step
