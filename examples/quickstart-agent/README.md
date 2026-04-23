# quickstart-agent

This example is the smallest installable Infopunks loop: Passport, Evidence, Trust, and Routing through `@infopunks/trust-sdk`.

## Install

```bash
npm install @infopunks/trust-sdk
```

## Run

```bash
node examples/quickstart-agent/index.mjs
```

## Environment

- `INFOPUNKS_API_KEY` defaults to `dev-infopunks-root-key` for the local-up path
- `INFOPUNKS_BASE_URL` defaults to `http://127.0.0.1:4010`

The script prints a compact trust decision object with `score`, `band`, `decision`, `recommended_validators`, `trace_id`, and `routing`.
