#!/usr/bin/env node

function usage() {
  console.error("Usage: node scripts/bazaar-discovery.mjs <search|merchant>");
  process.exit(1);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  const body = parseJson(text);
  console.log(JSON.stringify({ ok: response.ok, status: response.status, url, body }, null, 2));
  if (!response.ok) {
    process.exit(1);
  }
}

const mode = process.argv[2];
if (mode === "search") {
  await request("https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=infopunks%20trust%20layer&network=eip155:8453&asset=usdc&limit=20");
} else if (mode === "merchant") {
  const payTo = String(process.env.X402_PAY_TO ?? "").trim();
  if (!payTo) {
    throw new Error("X402_PAY_TO is required for bazaar:merchant.");
  }
  await request(`https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=${encodeURIComponent(payTo)}`);
} else {
  usage();
}
