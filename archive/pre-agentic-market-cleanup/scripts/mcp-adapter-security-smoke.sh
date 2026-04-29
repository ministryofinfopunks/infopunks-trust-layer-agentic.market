#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:4021}"

echo "== security smoke: unauthorized reconcile should fail =="
reconcile_status="$(curl -s -o /tmp/mcp-reconcile.out -w "%{http_code}" -X POST "${BASE_URL}/x402/reconcile")"
if [[ "${reconcile_status}" == "200" ]]; then
  echo "FAIL: reconcile endpoint is publicly callable"
  cat /tmp/mcp-reconcile.out
  exit 1
fi
echo "PASS: /x402/reconcile returned ${reconcile_status}"

echo "== security smoke: malformed MCP body rejected =="
mcp_status="$(curl -s -o /tmp/mcp-bad.out -w "%{http_code}" -X POST "${BASE_URL}/mcp" -H 'content-type: text/plain' --data 'not-json')"
if [[ "${mcp_status}" != "415" ]]; then
  echo "FAIL: expected 415 for non-json MCP body, got ${mcp_status}"
  cat /tmp/mcp-bad.out
  exit 1
fi
echo "PASS: non-json MCP body rejected with 415"

echo "== security smoke: webhook missing auth rejected =="
hook_status="$(curl -s -o /tmp/mcp-webhook.out -w "%{http_code}" -X POST "${BASE_URL}/x402/settlement/webhook" -H 'content-type: application/json' --data '{"status":"settled"}')"
if [[ "${hook_status}" == "200" ]]; then
  echo "WARN: webhook accepted unsigned event (check env auth config)"
else
  echo "PASS: webhook rejected unauthenticated event with ${hook_status}"
fi

echo "Security smoke checks completed."
