#!/usr/bin/env node

import { __testOnly } from "../services/mcp-adapter/src/transport/http-server.mjs";

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
  const resourceValue = challenge?.resource?.resource ?? challenge?.resource?.url ?? "";
  const inputSchemaErrors = __testOnly.validateJsonSchema(
    bazaar?.info?.input,
    bazaar?.schema?.properties?.input
  );
  const outputSchemaErrors = __testOnly.validateJsonSchema(
    bazaar?.info?.output,
    bazaar?.schema?.properties?.output
  );

  console.log(`status=${response.status}`);
  console.log(`x402Version=${challenge?.x402Version ?? ""}`);
  console.log(`resource=${resourceValue}`);
  console.log(`resource_path=${deriveResourcePath(resourceValue) ?? ""}`);
  console.log(`description_present=${Boolean(challenge?.resource?.description)}`);
  console.log(`mimeType_present=${Boolean(challenge?.resource?.mimeType)}`);
  console.log(`outputSchema_present=${Boolean(challenge?.resource?.outputSchema)}`);
  console.log(`bazaar_keys=${Object.keys(bazaar).join(",")}`);
  console.log(`bazaar_input_valid=${inputSchemaErrors.length === 0}`);
  console.log(`bazaar_output_valid=${outputSchemaErrors.length === 0}`);
  console.log(`bazaar_input_required=${(bazaar?.schema?.required ?? []).join(",")}`);
  console.log(`bazaar_tags=${(bazaar?.info?.tags ?? []).join(",")}`);
  console.log(`bazaar_category=${bazaar?.info?.category ?? ""}`);
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
