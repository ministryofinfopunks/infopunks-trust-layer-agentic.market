# CDP Facilitator Paid Proof

Endpoint:
POST https://infopunks-x402-adapter-cdp-staging.onrender.com/v1/resolve-trust

Proof:
- CDP direct verify: 200
- Paid buyer flow: final_status=200
- Event feed: paid_call.success
- Receipt ID: xrc_20f18f93-b15f-4b26-ae33-bc4e7910b21e
- Timestamp: 2026-04-28T20:50:13.597Z
- Facilitator provider: cdp
- Network: eip155:8453
- Asset: Base mainnet USDC
- Price: 0.01 USDC
- Amount: 10000 atomic USDC
- Header used: PAYMENT-SIGNATURE
- Subject: agent_public_paid_proof

Critical fix:
Base mainnet USDC EIP-712 domain name must be "USD Coin".
Display symbol remains "USDC".
