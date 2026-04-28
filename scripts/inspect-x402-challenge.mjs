#!/usr/bin/env node

function resolveBaseUrl() {
  const raw = String(process.env.PUBLIC_BASE_URL ?? process.env.INFOPUNKS_TRUST_API_URL ?? "").trim();
  if (!raw) {
    throw new Error("PUBLIC_BASE_URL (or INFOPUNKS_TRUST_API_URL) is required.");
  }
  return raw.replace(/\/$/, "");
}

function decodePaymentRequiredHeader(headerValue) {
  if (!headerValue) {
    throw new Error("PAYMENT-REQUIRED header missing.");
  }
  return JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
}

function deriveResourcePath(resourceUrl) {
  if (typeof resourceUrl !== "string" || !resourceUrl.trim()) {
    return null;
  }
  try {
    return new URL(resourceUrl).pathname;
  } catch {
    return null;
  }
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const endpoint = `${baseUrl}/v1/resolve-trust`;
  const response = await fetch(endpoint, { method: "POST" });
  const challenge = decodePaymentRequiredHeader(response.headers.get("payment-required"));
  const accept = challenge?.accepts?.[0] ?? {};
  const bazaar = challenge?.resource?.extensions?.bazaar ?? {};

  console.log(`status=${response.status}`);
  console.log(`x402Version=${challenge?.x402Version ?? ""}`);
  console.log(`resource_path=${deriveResourcePath(challenge?.resource?.url) ?? ""}`);
  console.log(`description_present=${Boolean(challenge?.resource?.description)}`);
  console.log(`mimeType_present=${Boolean(challenge?.resource?.mimeType)}`);
  console.log(`bazaar_keys=${Object.keys(bazaar).join(",")}`);
  console.log(`accept_network=${accept?.network ?? ""}`);
  console.log(`accept_asset=${accept?.asset ?? ""}`);
  console.log(`accept_payTo=${accept?.payTo ?? ""}`);
  console.log(`accept_amount=${accept?.amount ?? ""}`);
  console.log(`accept_extra_name=${accept?.extra?.name ?? ""}`);
  console.log(`accept_extra_version=${accept?.extra?.version ?? ""}`);
  console.log(`accept_extra_symbol=${accept?.extra?.symbol ?? ""}`);
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exit(1);
});
