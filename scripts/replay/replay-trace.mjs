const traceId = process.argv[2];

if (!traceId) {
  console.error("Usage: npm run replay -- <trace_id>");
  process.exit(1);
}

const response = await fetch(`${process.env.INFOPUNKS_BASE_URL || "http://127.0.0.1:4010"}/v1/traces/${encodeURIComponent(traceId)}`, {
  headers: {
    authorization: `Bearer ${process.env.INFOPUNKS_API_KEY || "dev-infopunks-key"}`
  }
});

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

console.log(JSON.stringify(await response.json(), null, 2));
