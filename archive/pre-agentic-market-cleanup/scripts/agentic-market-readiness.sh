#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "${BASE_URL}" ]]; then
  echo "Usage: $0 <public_base_url>"
  echo "Example: $0 https://mcp.infopunks.ai"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

echo "== Agentic.Market readiness check =="
echo "Base URL: ${BASE_URL}"

echo
echo "== 1) Public reachability =="
root_status="$(curl -s -o /tmp/mcp-root.out -w "%{http_code}" "${BASE_URL}/")"
if [[ "${root_status}" != "200" ]]; then
  echo "FAIL: root endpoint unreachable (${root_status})"
  cat /tmp/mcp-root.out
  exit 1
fi
echo "PASS: root reachable"

echo
echo "== 2) Discovery metadata reachability =="
disc_status="$(curl -s -o /tmp/mcp-discovery.out -w "%{http_code}" "${BASE_URL}/.well-known/x402-bazaar.json")"
if [[ "${disc_status}" != "200" ]]; then
  echo "FAIL: discovery endpoint unavailable (${disc_status})"
  cat /tmp/mcp-discovery.out
  exit 1
fi
if ! jq -e '.service.name and .discovery.mcp_endpoint and (.tools | length > 0)' /tmp/mcp-discovery.out >/dev/null; then
  echo "FAIL: discovery document missing required fields"
  cat /tmp/mcp-discovery.out
  exit 1
fi
echo "PASS: discovery document valid"

echo
echo "== 3) Marketplace manifest reachability =="
manifest_status="$(curl -s -o /tmp/mcp-market-manifest.out -w "%{http_code}" "${BASE_URL}/.well-known/agentic-marketplace.json")"
if [[ "${manifest_status}" != "200" ]]; then
  echo "FAIL: marketplace manifest endpoint unavailable (${manifest_status})"
  cat /tmp/mcp-market-manifest.out
  exit 1
fi
if ! jq -e '.service.name and .discovery.url and .payment.pricing_units' /tmp/mcp-market-manifest.out >/dev/null; then
  echo "FAIL: malformed marketplace manifest"
  cat /tmp/mcp-market-manifest.out
  exit 1
fi
echo "PASS: marketplace manifest valid"

echo
echo "== 4) Marketplace readiness signals =="
ready_status="$(curl -s -o /tmp/mcp-ready.out -w "%{http_code}" "${BASE_URL}/marketplace/readiness")"
if [[ "${ready_status}" != "200" ]]; then
  echo "FAIL: marketplace readiness endpoint unavailable (${ready_status})"
  cat /tmp/mcp-ready.out
  exit 1
fi
if ! jq -e '.signals and .ready_for_listing != null' /tmp/mcp-ready.out >/dev/null; then
  echo "FAIL: malformed readiness payload"
  cat /tmp/mcp-ready.out
  exit 1
fi
echo "Readiness:"
jq '.signals + {ready_for_listing: .ready_for_listing}' /tmp/mcp-ready.out

echo
echo "== 5) Paid path exercise (production-like) =="
REQUEST_ID="agentic-ready-$(date +%s)"
if [[ -n "${FACILITATOR_PAYMENT_JSON:-}" ]]; then
  SUBJECT="${FACILITATOR_CALL_SUBJECT_ID:-agent_221}"
  read -r -d '' BODY <<EOF || true
{
  "jsonrpc":"2.0",
  "id":"${REQUEST_ID}",
  "method":"tools/call",
  "params":{
    "name":"resolve_trust",
    "arguments":{
      "subject_id":"${SUBJECT}",
      "context":{"task_type":"listing_readiness_probe","domain":"marketplace","risk_level":"medium"},
      "payment": ${FACILITATOR_PAYMENT_JSON}
    }
  }
}
EOF
  if [[ -n "${MCP_ENTITLEMENT_TOKEN:-}" ]]; then
    paid_status="$(curl -s -o /tmp/mcp-paid.out -w "%{http_code}" -X POST "${BASE_URL}/mcp" -H "content-type: application/json" -H "Authorization: Bearer ${MCP_ENTITLEMENT_TOKEN}" --data "${BODY}")"
  else
    paid_status="$(curl -s -o /tmp/mcp-paid.out -w "%{http_code}" -X POST "${BASE_URL}/mcp" -H "content-type: application/json" --data "${BODY}")"
  fi
  if [[ "${paid_status}" != "200" ]]; then
    echo "FAIL: paid MCP call transport failed (${paid_status})"
    cat /tmp/mcp-paid.out
    exit 1
  fi
  if jq -e '.result.structuredContent.meta.payment_receipt_id // empty' /tmp/mcp-paid.out >/dev/null; then
    echo "PASS: paid call succeeded with receipt linkage"
    jq '.result.structuredContent.meta | {tool, billed_units, payment_receipt_id, adapter_trace_id, internal_trace_id}' /tmp/mcp-paid.out
  else
    echo "PASS WITH GAPS: paid call transport worked but no receipt linkage observed"
    jq '.' /tmp/mcp-paid.out
  fi
else
  echo "No FACILITATOR_PAYMENT_JSON provided."
  echo "Running challenge behavior check for paid route..."
  read -r -d '' CHALLENGE_BODY <<EOF || true
{
  "jsonrpc":"2.0",
  "id":"${REQUEST_ID}",
  "method":"tools/call",
  "params":{
    "name":"resolve_trust",
    "arguments":{
      "subject_id":"agent_221",
      "context":{"task_type":"listing_readiness_probe","domain":"marketplace","risk_level":"medium"}
    }
  }
}
EOF
  challenge_status="$(curl -s -o /tmp/mcp-challenge.out -w "%{http_code}" -X POST "${BASE_URL}/mcp" -H "content-type: application/json" --data "${CHALLENGE_BODY}")"
  if [[ "${challenge_status}" != "200" ]]; then
    echo "FAIL: paid route probe transport failed (${challenge_status})"
    cat /tmp/mcp-challenge.out
    exit 1
  fi
  if jq -e '.result.structuredContent.error.code == "ENTITLEMENT_REQUIRED" or .result.structuredContent.error.code == "PAYMENT_VERIFICATION_FAILED"' /tmp/mcp-challenge.out >/dev/null; then
    echo "PASS: paid route is gated and challenge path is active"
    jq '.result.structuredContent.error | {code, message, adapter_trace_id}' /tmp/mcp-challenge.out
  else
    echo "PASS WITH GAPS: paid route probe did not return expected challenge semantics"
    jq '.' /tmp/mcp-challenge.out
  fi
fi

echo
echo "Agentic.Market readiness script completed."
