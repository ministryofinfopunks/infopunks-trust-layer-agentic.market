# API Overview

Base path: `/v1`

Contract source of truth:

- `openapi.yaml` at the repository root

Authentication:

- `Authorization: Bearer <token>`
- API keys are environment-bound and scope-bound in V1.
- Read endpoints require `read` scope.
- Mutating endpoints require `write` scope.

Primary endpoints:

- `POST /v1/budget/quote`
- `POST /v1/passports`
- `GET /v1/passports/{subject_id}`
- `POST /v1/evidence`
- `POST /v1/disputes/evaluate`
- `POST /v1/trust/resolve`
- `POST /v1/routing/select-validator`
- `POST /v1/routing/select-executor`
- `POST /v1/webhooks`
- `POST /v1/portability/export`
- `POST /v1/portability/import`
- `POST /v1/economic/escrow-quote`
- `POST /v1/economic/risk-price`
- `POST /v1/economic/attestation-bundle`
- `GET /v1/events/stream`
- `GET /v1/traces/{trace_id}`
- `GET /v1/trust/{subject_id}/explain`
- `GET /v1/war-room/state`
- `POST /v1/sim/run`

Canonical layers:

- Passport Layer
- Evidence Layer
- Trust Engine
- Event Rail
- War Room Surface

Response shaping:

- `minimal`
- `standard`
- `explain`
- `audit`

Every JSON resource also carries:

- `response_cost`
- `budget_hints`

Stable resource shapes:

- `GET /v1/prompts/{name}` returns a `prompt_pack` resource.
- `GET /v1/traces/{trace_id}` returns a `trace_replay_bundle` resource.
- `GET /v1/trust/{subject_id}/explain` returns a `trust_explanation` resource.
- `GET /v1/war-room/state` returns a `war_room_state` resource.

Local dev profile notes:

- The local implementation uses SQLite instead of Postgres/Kafka/ClickHouse to keep installation friction low.
- Evidence remains append-only and idempotent.
- Snapshots are recomputed inline after ingest for deterministic local behavior.
- Events are persisted and streamed over SSE from the same control-plane process.
- Portability receipts are HMAC-signed for local/dev cross-instance trust carriage.
- Economic hooks are deterministic quotes and attestation surfaces, not billing rails.

Normalized error codes include:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `INVALID_REQUEST`
- `NOT_FOUND`
- `PASSPORT_REVOKED`
- `PASSPORT_SUSPENDED`
- `LOW_CONFIDENCE`
- `TRACE_UNAVAILABLE`
- `IDEMPOTENCY_CONFLICT`
