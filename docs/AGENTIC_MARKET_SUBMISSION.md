# Agentic.Market Submission Checklist

## Public Endpoint Checklist

- Public base URL: `https://infopunks-x402-adapter-cdp-staging.onrender.com`
- `GET /health` returns `200` with `{ "status": "ok" }`.
- `GET /openapi.json` returns `200` and documents `/v1/resolve-trust` plus `/v1/events/recent`.
- `GET /.well-known/infopunks-trust-layer.json` returns `200` and points to the paid trust primitive.
- `GET /v1/events/recent` returns sanitized recent War Room events without payer addresses, payment payloads, secrets, nonces, or idempotency keys.
- `POST /v1/resolve-trust` without payment returns `402` with a base64 `PAYMENT-REQUIRED` challenge.
- `POST /v1/resolve-trust` is the only paid endpoint.

## Testnet Receipt Checklist

- Run challenge-only public smoke:

```bash
PUBLIC_BASE_URL=https://infopunks-x402-adapter-cdp-staging.onrender.com npm run smoke:public:testnet
```

- Save the decoded `PAYMENT-REQUIRED` challenge from the smoke output.
- Build or obtain one valid testnet x402 payment payload for that challenge.
- Run paid public smoke:

```bash
PUBLIC_BASE_URL=https://infopunks-x402-adapter-cdp-staging.onrender.com \
X_PAYMENT_B64=<base64-x402-payment-payload> \
npm run smoke:public:testnet
```

- Confirm paid response status is `200`.
- Confirm `receipt.x402_verified` is `true`.
- Record `receipt.payment_receipt_id`.
- Confirm `/v1/events/recent` shows a sanitized event for the paid call.

## Listing Copy Placeholders

- Name: Infopunks Trust Layer
- One-line description: Paid x402 trust resolution for agents before routing work, capital, validation, execution, or payment.
- Paid primitive: `POST /v1/resolve-trust`
- Public proof endpoint: `GET /v1/events/recent`
- Network: `<Base Sepolia for testnet / Base mainnet for production>`
- Asset: `<USDC contract address>`
- Price: `<price per trust resolution>`
- Buyer instructions: Call unpaid once, decode `PAYMENT-REQUIRED`, attach `x-payment`, retry.

## Go/No-Go Criteria

- Go if `npm run build`, `npm run test`, and `npm run smoke` pass.
- Go if public smoke verifies health, OpenAPI, manifest, and unpaid `402`.
- Go if a paid testnet call returns `200` with `receipt.x402_verified === true`.
- Go if successful paid calls create sanitized `/v1/events/recent` entries.
- No-go if any public endpoint exposes payer addresses, payment payloads, private keys, nonces, secrets, or facilitator credentials.
- No-go if any endpoint other than `POST /v1/resolve-trust` requires x402 payment.
