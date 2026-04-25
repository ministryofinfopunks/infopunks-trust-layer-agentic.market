# First Paid Calls Proof Pack

Use this pack to generate reproducible launch artifacts for the first paid trust calls.

## Required env vars

- `INFOPUNKS_TRUST_API_URL` (example: `http://127.0.0.1:4021`)
- `PROOF_NETWORK` (example: `eip155:84532`)
- `X402_PAY_TO` (receiver address)
- `FACILITATOR_PAYMENT_JSON` (or equivalent payment payload fields your environment accepts)
- Optional: `INFOPUNKS_API_KEY` when your endpoint requires bearer auth

Safety guard:

- Mainnet is blocked by default.
- To run against Base mainnet (`eip155:8453`), explicitly set:
  - `INFOPUNKS_ALLOW_MAINNET_PROOF=true`

## Commands

- Single paid call:
  - `npm run proof:paid-call`
- Controlled sequence:
  - `npm run proof:paid-sequence`

## Two external wallet test instructions

Run the sequence once per wallet with a wallet-specific payer and payment payload.

Wallet 1:

```bash
export INFOPUNKS_TRUST_API_URL="http://127.0.0.1:4021"
export PROOF_NETWORK="eip155:84532"
export X402_PAY_TO="0xYOUR_PAYTO"
export FACILITATOR_PAYMENT_JSON='{"rail":"x402","payer":"0xWALLET_ONE","units_authorized":5}'
npm run proof:paid-sequence
```

Wallet 2:

```bash
export INFOPUNKS_TRUST_API_URL="http://127.0.0.1:4021"
export PROOF_NETWORK="eip155:84532"
export X402_PAY_TO="0xYOUR_PAYTO"
export FACILITATOR_PAYMENT_JSON='{"rail":"x402","payer":"0xWALLET_TWO","units_authorized":5}'
npm run proof:paid-sequence
```

Confirm both wallets appear:

- Open War Room: `/war-room`
- Or query feed: `/api/war-room/events`
- Verify `payer` includes both `0xWALLET_ONE` and `0xWALLET_TWO`.

## Artifacts generated

Under `artifacts/launch-proof/`:

- `receipts.json`
- `trust-call-logs.json`
- `war-room-events.json`
- `proof-summary.md`

