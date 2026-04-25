# Trust Resolution

V1 resolves trust from:

- Passport status and identity integrity
- append-only evidence history
- rolling trust snapshot windows
- domain-matched evidence only
- deterministic policy rules
- evented trust transitions that can drive agent behavior

The source of truth is evidence. Scores are derived views.

## Trust Vector (trust-v1)

Trust resolution now emits a multidimensional trust vector:

- executionReliability
- economicIntegrity
- identityCredibility
- behavioralStability
- dependencyRisk
- adversarialRisk
- evidenceFreshness
- overallTrust

Each dimension is normalized to `0..100`.

The API also emits a policy decision object with enforceable controls (`ALLOW`, `RATE_LIMIT`, `REQUIRE_ESCROW`, `REQUIRE_SECONDARY_VALIDATION`, `MANUAL_REVIEW`, `BLOCK`, `QUARANTINE`) and a trust state:

- `UNKNOWN`
- `VERIFIED`
- `DEGRADING`
- `RISKY`
- `COMPROMISED`
- `QUARANTINED`

Legacy compatibility remains in place via `score` and `trust_score`.

## Determinism contract

For a given:

- subject
- context
- policy version
- engine version
- snapshot version

the trust output is deterministic. Trace artifacts persist those exact inputs plus the output so the decision can be replayed and verified later.

## Replay contract

`GET /v1/traces/{trace_id}` returns:

- stored trace artifact
- referenced Passport
- snapshot used by the decision
- referenced evidence lineage
- stored resolution or routing decision
- replay check for trust decisions

The API surfaces this as a stable `trace_replay_bundle` resource so agents can distinguish replay artifacts from ordinary query results without guessing by field presence.
