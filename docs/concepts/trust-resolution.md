# Trust Resolution

V1 resolves trust from:

- Passport status and identity integrity
- append-only evidence history
- rolling trust snapshot windows
- domain-matched evidence only
- deterministic policy rules
- evented trust transitions that can drive agent behavior

The source of truth is evidence. Scores are derived views.

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
