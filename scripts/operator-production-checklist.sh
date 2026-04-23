#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "${BASE_URL}" ]]; then
  echo "Usage: $0 <public_base_url>"
  echo "Example: $0 https://mcp.infopunks.ai"
  exit 1
fi

for cmd in curl jq openssl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

if [[ -z "${MCP_ENTITLEMENT_TOKEN:-}" ]]; then
  echo "MCP_ENTITLEMENT_TOKEN is required for real paid call verification."
  exit 1
fi
if [[ -z "${FACILITATOR_PAYMENT_JSON:-}" ]]; then
  echo "FACILITATOR_PAYMENT_JSON is required for real paid call verification."
  exit 1
fi
if [[ -z "${MCP_ADAPTER_ADMIN_TOKEN:-}" ]]; then
  echo "MCP_ADAPTER_ADMIN_TOKEN is required for reconciliation verification."
  exit 1
fi
if [[ -z "${X402_SETTLEMENT_WEBHOOK_HMAC_SECRET:-}" ]]; then
  echo "X402_SETTLEMENT_WEBHOOK_HMAC_SECRET is required for signed settlement webhook verification."
  exit 1
fi

SUBJECT_ID="${FACILITATOR_CALL_SUBJECT_ID:-agent_221}"
REQ_ID="ops-$(date +%s)"

echo "== Operator production checklist =="
echo "Base URL: ${BASE_URL}"
echo

echo "== 1) Infrastructure reachability =="
root_status="$(curl -s -o /tmp/op-root.out -w "%{http_code}" "${BASE_URL}/")"
health_status="$(curl -s -o /tmp/op-health.out -w "%{http_code}" "${BASE_URL}/healthz")"
ready_status="$(curl -s -o /tmp/op-ready.out -w "%{http_code}" "${BASE_URL}/marketplace/readiness")"
disc_status="$(curl -s -o /tmp/op-disc.out -w "%{http_code}" "${BASE_URL}/.well-known/x402-bazaar.json")"
manifest_status="$(curl -s -o /tmp/op-manifest.out -w "%{http_code}" "${BASE_URL}/.well-known/agentic-marketplace.json")"

[[ "${root_status}" == "200" ]] || { echo "FAIL root ${root_status}"; cat /tmp/op-root.out; exit 1; }
[[ "${health_status}" == "200" || "${health_status}" == "206" ]] || { echo "FAIL healthz ${health_status}"; cat /tmp/op-health.out; exit 1; }
[[ "${ready_status}" == "200" ]] || { echo "FAIL readiness ${ready_status}"; cat /tmp/op-ready.out; exit 1; }
[[ "${disc_status}" == "200" ]] || { echo "FAIL discovery ${disc_status}"; cat /tmp/op-disc.out; exit 1; }
[[ "${manifest_status}" == "200" ]] || { echo "FAIL manifest ${manifest_status}"; cat /tmp/op-manifest.out; exit 1; }
echo "PASS infrastructure reachability"
echo

echo "== 2) Environment/readiness signals =="
jq -e '.signals.public_url_configured == true' /tmp/op-ready.out >/dev/null
jq -e '.signals.facilitator_mode_enabled == true' /tmp/op-ready.out >/dev/null
jq -e '.signals.verifier_connected == true' /tmp/op-ready.out >/dev/null
jq -e '.signals.settlement_webhook_configured == true' /tmp/op-ready.out >/dev/null
jq -e '.signals.admin_security_configured == true' /tmp/op-ready.out >/dev/null
jq -e '.signals.entitlement_policy_ready == true' /tmp/op-ready.out >/dev/null
jq -e '.signals.discovery_metadata_valid == true' /tmp/op-ready.out >/dev/null
echo "PASS environment/readiness signals"
echo

echo "== 3) No localhost leaks in discovery surfaces =="
if rg -n "127\\.0\\.0\\.1|localhost" /tmp/op-disc.out /tmp/op-manifest.out >/tmp/op-localhost.out; then
  echo "FAIL localhost leak found in discovery/manifest output:"
  cat /tmp/op-localhost.out
  exit 1
fi
echo "PASS no localhost leaks"
echo

echo "== 4) One real paid call succeeds =="
read -r -d '' PAID_BODY <<EOF || true
{
  "jsonrpc":"2.0",
  "id":"${REQ_ID}",
  "method":"tools/call",
  "params":{
    "name":"export_portability_bundle",
    "arguments":{
      "agent":{"id":"${SUBJECT_ID}","marketplace":"agentic.market","runtime":"mcp"},
      "subject_id":"${SUBJECT_ID}",
      "include_evidence": true,
      "evidence_limit": 10,
      "include_trace_ids": true,
      "target_network": "agentic.market",
      "payment": ${FACILITATOR_PAYMENT_JSON}
    }
  }
}
EOF

paid_status="$(curl -s -o /tmp/op-paid.out -w "%{http_code}" -X POST "${BASE_URL}/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer ${MCP_ENTITLEMENT_TOKEN}" \
  --data "${PAID_BODY}")"
[[ "${paid_status}" == "200" ]] || { echo "FAIL paid call transport ${paid_status}"; cat /tmp/op-paid.out; exit 1; }

jq -e '.result.structuredContent.meta.payment_receipt_id // empty' /tmp/op-paid.out >/dev/null
jq -e '.result.structuredContent.meta.billed_units >= 1' /tmp/op-paid.out >/dev/null
RECEIPT_ID="$(jq -r '.result.structuredContent.meta.payment_receipt_id' /tmp/op-paid.out)"
VERIFIER_REF="$(jq -r '.result.structuredContent.meta.x402_receipt.verifier_reference // empty' /tmp/op-paid.out)"
echo "PASS paid call + receipt created: ${RECEIPT_ID}"
echo

echo "== 5) Replay blocked =="
replay_status="$(curl -s -o /tmp/op-replay.out -w "%{http_code}" -X POST "${BASE_URL}/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer ${MCP_ENTITLEMENT_TOKEN}" \
  --data "${PAID_BODY}")"
[[ "${replay_status}" == "200" ]] || { echo "FAIL replay call transport ${replay_status}"; cat /tmp/op-replay.out; exit 1; }
jq -e '.result.structuredContent.error.code == "PAYMENT_REPLAY_DETECTED"' /tmp/op-replay.out >/dev/null
echo "PASS replay blocked"
echo

echo "== 6) Reconciliation works =="
reconcile_status="$(curl -s -o /tmp/op-reconcile.out -w "%{http_code}" -X POST "${BASE_URL}/x402/reconcile" \
  -H "Authorization: Bearer ${MCP_ADAPTER_ADMIN_TOKEN}")"
[[ "${reconcile_status}" == "200" ]] || { echo "FAIL reconcile endpoint ${reconcile_status}"; cat /tmp/op-reconcile.out; exit 1; }

SETTLEMENT_PAYLOAD="$(jq -nc --arg rid "${RECEIPT_ID}" --arg vref "${VERIFIER_REF}" '{receipt_id:$rid, verifier_reference:($vref|select(length>0)), status:"settled"}')"
TIMESTAMP="$(date +%s)"
SIGNATURE="$(printf "%s.%s" "${TIMESTAMP}" "${SETTLEMENT_PAYLOAD}" | openssl dgst -sha256 -hmac "${X402_SETTLEMENT_WEBHOOK_HMAC_SECRET}" -binary | xxd -p -c 256)"

webhook_status="$(curl -s -o /tmp/op-webhook.out -w "%{http_code}" -X POST "${BASE_URL}/x402/settlement/webhook" \
  -H "content-type: application/json" \
  -H "x-webhook-timestamp: ${TIMESTAMP}" \
  -H "x-webhook-signature: ${SIGNATURE}" \
  --data "${SETTLEMENT_PAYLOAD}")"
[[ "${webhook_status}" == "200" ]] || { echo "FAIL settlement webhook ${webhook_status}"; cat /tmp/op-webhook.out; exit 1; }

echo "PASS reconciliation + signed webhook settlement"
echo
echo "CHECKLIST_PASS: production payment/topology checks passed."
