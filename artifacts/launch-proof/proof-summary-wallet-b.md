# Launch Proof Summary

- Generated at: 2026-04-24T13:19:20.539Z
- Total calls: 6
- Successful calls: 0
- Failed/rejected calls: 5
- Degraded calls: 0
- Receipts: none
- Subjects checked: agent_001, agent_low_001, agent_bootstrap_1777036740223_6779f4, not_run
- War Room URL: https://infopunks-x402-adapter.onrender.com/war-room

## Calls

| label | status | subject_id | payer | trust_score | trust_tier | mode | confidence | receipt_id | error_code |
|---|---|---|---|---:|---|---|---:|---|---|
| A_trusted_executor_call | 402 | agent_001 | 0x1111111111111111111111111111111111111111 |  |  |  |  |  | PAYMENT_VERIFICATION_FAILED |
| B_low_trust_executor_call | 402 | agent_low_001 | 0x1111111111111111111111111111111111111111 |  |  |  |  |  | PAYMENT_VERIFICATION_FAILED |
| C_unknown_subject_auto_bootstrap | 402 | agent_bootstrap_1777036740223_6779f4 | 0x1111111111111111111111111111111111111111 |  |  |  |  |  | PAYMENT_VERIFICATION_FAILED |
| D1_replay_control_first | 402 | agent_001 | 0x1111111111111111111111111111111111111111 |  |  |  |  |  | PAYMENT_VERIFICATION_FAILED |
| D2_replay_attempt_second | 402 | agent_001 | 0x1111111111111111111111111111111111111111 |  |  |  |  |  | PAYMENT_VERIFICATION_FAILED |
| E_degraded_fallback_attempt | 0 | not_run |  |  |  |  |  |  |  |

## Wallet Testing (2 External Wallets)

1. Set env vars per wallet before each run:
   - `FACILITATOR_PAYMENT_JSON` with wallet-specific `payer`, `nonce`, `idempotency_key` (or allow script to override nonce/idempotency).
   - `INFOPUNKS_TRUST_API_URL`, `PROOF_NETWORK`, optional `X402_PAY_TO`.
2. Run `npm run proof:paid-sequence` once per wallet.
3. Confirm both wallet addresses appear as `payer` values in War Room at `/war-room` or via `/api/war-room/events`.

## Notes

- Captured War Room events in this run: 0