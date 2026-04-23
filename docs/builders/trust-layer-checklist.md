# Trust Layer Checklist

Use this when adding Infopunks to an existing agent runtime.

- Every acting subject has a Passport.
- Every consequential task emits append-only evidence.
- High-risk work calls `trust.resolve` before execution.
- Validator choice comes from `routing.selectValidator`, not prompt heuristics.
- Executor choice comes from `routing.selectExecutor` when work allocation matters.
- `trust.collapse`, `route.changed`, and `trust.confidence_low` are subscribed somewhere durable.
- Disagreements route through `disputes.evaluate`.
- Cross-network handoff uses `portability.export` and `portability.import`.
- Insurance, escrow, or marketplace integrations consume `economic.*` hooks instead of reverse engineering trust state.
- War Room is available for replay, drift review, and operator awareness.
