#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-3d0e6986-1b31-4189-a394-b3289d54efb0}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rappter_ai}"
FUNCTION_APP="${ROLLING_CORES_FUNCTION_APP:-rappter-rolling-cores-3d0e6986}"
STORAGE_ACCOUNT="${ROLLING_CORES_STORAGE_ACCOUNT:-rapprolling3d0e6986}"
TABLE_NAME="${ROLLING_CORES_TABLE_NAME:-RapterCreditRegistry}"
KEY_VAULT="${ROLLING_CORES_KEY_VAULT:-rappter-credit-3d0e6986}"
SIGNING_KEY="${ROLLING_CORES_SIGNING_KEY:-credit-registry-signing-v1}"
PROFILE_ID="${ROLLING_CORES_PROFILE_ID:-wild-rappter-gpt-5-4}"
SERVICE="com.rapterbox.rollingcores.openai-compatible"
ENDPOINT="https://${FUNCTION_APP}.azurewebsites.net"
STATE_DIR="$APP_DIR/.deploy"

az account set --subscription "$SUBSCRIPTION_ID"
mkdir -p "$STATE_DIR"

HEALTH_STATUS="000"
for _ in $(seq 1 30); do
  HEALTH_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/health.json" \
      --write-out '%{http_code}' \
      "$ENDPOINT/health" || true
  )"
  if [[ "$HEALTH_STATUS" == "200" ]]; then break; fi
  sleep 10
done
if [[ "$HEALTH_STATUS" != "200" ]]; then
  printf 'Health smoke failed with HTTP %s\n' "$HEALTH_STATUS" >&2
  exit 1
fi

UNAUTH_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/models" || true
)"
if [[ "$UNAUTH_STATUS" != "401" && "$UNAUTH_STATUS" != "403" ]]; then
  printf 'Unauthenticated model request was not refused (HTTP %s)\n' "$UNAUTH_STATUS" >&2
  exit 1
fi

QUOTE_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/credit-quote.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/credit-registry/quote?set_id=genesis-2026" || true
)"
ISSUER_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/credit-issuer.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/credit-registry/issuer" || true
)"
REGISTRY_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/credit-list.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/credit-registry/credits" || true
)"
SCHEDULE_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/valuation-schedules.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/credit-registry/schedules" || true
)"
if [[ "$QUOTE_STATUS" != "404" || "$ISSUER_STATUS" != "200" || "$REGISTRY_STATUS" != "200" || "$SCHEDULE_STATUS" != "200" ]]; then
  printf 'Public credit registry smoke failed (%s/%s/%s/%s).\n' \
    "$SCHEDULE_STATUS" "$QUOTE_STATUS" "$ISSUER_STATUS" "$REGISTRY_STATUS" >&2
  exit 1
fi

UNAUTH_REDEEM_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-redeem.json" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --data '{}' \
    "$ENDPOINT/v1/purchases/redeem" || true
)"
UNAUTH_CAPSULE_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-capsule.json" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --data '{}' \
    "$ENDPOINT/v1/capsules/authorize-download" || true
)"
UNAUTH_SCHEDULE_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-schedule.json" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --data '{}' \
    "$ENDPOINT/v1/issuer/valuation-schedules" || true
)"
if [[ "$UNAUTH_REDEEM_STATUS" != "401" || "$UNAUTH_CAPSULE_STATUS" != "401" || "$UNAUTH_SCHEDULE_STATUS" != "401" ]]; then
  printf 'Authenticated credit endpoint boundary failed (%s/%s/%s).\n' \
    "$UNAUTH_REDEEM_STATUS" "$UNAUTH_CAPSULE_STATUS" "$UNAUTH_SCHEDULE_STATUS" >&2
  exit 1
fi

UNAUTH_BREATH_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-breathing.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/breathing/status" || true
)"
if [[ "$UNAUTH_BREATH_STATUS" != "401" ]]; then
  printf 'Unauthenticated Wild breathing status was not refused (HTTP %s).\n' \
    "$UNAUTH_BREATH_STATUS" >&2
  exit 1
fi
WILD_TEST_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
for function_name in wild_breathing_status wild_breathing_start wild_breathing_pause; do
  az functionapp function keys set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --function-name "$function_name" \
    --key-name private-breath-test \
    --key-value="$WILD_TEST_KEY" \
    --output none
done
cat >"$STATE_DIR/wild-breathing-start.json" <<'JSON'
{
  "organism_rappid": "rappid:@smoke/rapter:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "limits": {
    "interval_seconds": 300,
    "max_ticks": 6,
    "max_output_tokens_per_tick": 512,
    "max_total_output_tokens": 3072,
    "lease_seconds": 3600
  },
  "acknowledge_metered_compute": true
}
JSON
WILD_STATUS="000"
WILD_START_STATUS="000"
WILD_PAUSE_STATUS="000"
for _ in $(seq 1 6); do
  WILD_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/wild-breathing-status.json" \
      --write-out '%{http_code}' \
      --header "x-functions-key: $WILD_TEST_KEY" \
      "$ENDPOINT/v1/breathing/status" || true
  )"
  WILD_START_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/wild-breathing-start-response.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'content-type: application/json' \
      --header "x-functions-key: $WILD_TEST_KEY" \
      --data-binary "@$STATE_DIR/wild-breathing-start.json" \
      "$ENDPOINT/v1/breathing/start" || true
  )"
  WILD_PAUSE_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/wild-breathing-pause.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'content-type: application/json' \
      --header "x-functions-key: $WILD_TEST_KEY" \
      --data '{"organism_rappid":"rappid:@smoke/rapter:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' \
      "$ENDPOINT/v1/breathing/pause" || true
  )"
  if [[ "$WILD_STATUS" == "200" && "$WILD_START_STATUS" == "403" && "$WILD_PAUSE_STATUS" == "200" ]]; then
    break
  fi
  sleep 5
done
unset WILD_TEST_KEY
for function_name in wild_breathing_status wild_breathing_start wild_breathing_pause; do
  az functionapp function keys delete \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --function-name "$function_name" \
    --key-name private-breath-test \
    --output none
done
if [[ "$WILD_STATUS" != "200" || "$WILD_START_STATUS" != "403" || "$WILD_PAUSE_STATUS" != "200" ]]; then
  printf 'Wild breathing boundary failed (%s/%s/%s).\n' \
    "$WILD_STATUS" "$WILD_START_STATUS" "$WILD_PAUSE_STATUS" >&2
  exit 1
fi

LIFECYCLE_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/lifecycle-status.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/credit-registry/lifecycle/status" || true
)"
UNAUTH_RETURN_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-return.json" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --data '{}' \
    "$ENDPOINT/v1/credits/return" || true
)"
UNAUTH_LISTING_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-listing.json" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --data '{}' \
    "$ENDPOINT/v1/resale/listings" || true
)"
if [[ "$LIFECYCLE_STATUS" != "200" || "$UNAUTH_RETURN_STATUS" != "401" || "$UNAUTH_LISTING_STATUS" != "401" ]]; then
  printf 'Return/resale boundary failed (%s/%s/%s).\n' \
    "$LIFECYCLE_STATUS" "$UNAUTH_RETURN_STATUS" "$UNAUTH_LISTING_STATUS" >&2
  exit 1
fi
LIFECYCLE_TEST_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
for function_name in credit_return resale_listing; do
  az functionapp function keys set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --function-name "$function_name" \
    --key-name private-lifecycle-test \
    --key-value="$LIFECYCLE_TEST_KEY" \
    --output none
done
RETURN_NO_OWNER_STATUS="000"
LISTING_NO_OWNER_STATUS="000"
for _ in $(seq 1 6); do
  RETURN_NO_OWNER_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/return-no-owner.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'content-type: application/json' \
      --header "x-functions-key: $LIFECYCLE_TEST_KEY" \
      --data '{"operation_id":"smoke-return","credit_id":"rcredit:0000000000000000000000000000000000000000000000000000000000000000","refund_proof":"not-a-real-receipt"}' \
      "$ENDPOINT/v1/credits/return" || true
  )"
  LISTING_NO_OWNER_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/listing-no-owner.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'content-type: application/json' \
      --header "x-functions-key: $LIFECYCLE_TEST_KEY" \
      --data '{"operation_id":"smoke-listing","credit_id":"rcredit:0000000000000000000000000000000000000000000000000000000000000000","ask_price_sats":100}' \
      "$ENDPOINT/v1/resale/listings" || true
  )"
  if [[ "$RETURN_NO_OWNER_STATUS" == "403" && "$LISTING_NO_OWNER_STATUS" == "403" ]]; then
    break
  fi
  sleep 5
done
unset LIFECYCLE_TEST_KEY
for function_name in credit_return resale_listing; do
  az functionapp function keys delete \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --function-name "$function_name" \
    --key-name private-lifecycle-test \
    --output none
done
if [[ "$RETURN_NO_OWNER_STATUS" != "403" || "$LISTING_NO_OWNER_STATUS" != "403" ]]; then
  printf 'Scoped owner authorization boundary failed (%s/%s).\n' \
    "$RETURN_NO_OWNER_STATUS" "$LISTING_NO_OWNER_STATUS" >&2
  exit 1
fi

ARTIFACT_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/artifact-status.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/artifacts/status" || true
)"
UNAUTH_ARTIFACT_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-artifact-release.json" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --data '{}' \
    "$ENDPOINT/v1/artifacts/release-key" || true
)"
if [[ "$ARTIFACT_STATUS" != "200" || "$UNAUTH_ARTIFACT_STATUS" != "401" ]]; then
  printf 'Artifact delivery boundary failed (%s/%s).\n' \
    "$ARTIFACT_STATUS" "$UNAUTH_ARTIFACT_STATUS" >&2
  exit 1
fi
ARTIFACT_TEST_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
az functionapp function keys set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name artifact_release_key \
  --key-name private-artifact-test \
  --key-value="$ARTIFACT_TEST_KEY" \
  --output none
ARTIFACT_NO_TOKEN_STATUS="000"
for _ in $(seq 1 6); do
  ARTIFACT_NO_TOKEN_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/artifact-no-token.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'content-type: application/json' \
      --header "x-functions-key: $ARTIFACT_TEST_KEY" \
      --data '{}' \
      "$ENDPOINT/v1/artifacts/release-key" || true
  )"
  if [[ "$ARTIFACT_NO_TOKEN_STATUS" == "403" ]]; then break; fi
  sleep 5
done
unset ARTIFACT_TEST_KEY
az functionapp function keys delete \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name artifact_release_key \
  --key-name private-artifact-test \
  --output none
if [[ "$ARTIFACT_NO_TOKEN_STATUS" != "403" ]]; then
  printf 'Artifact release without scoped token was not refused (HTTP %s).\n' \
    "$ARTIFACT_NO_TOKEN_STATUS" >&2
  exit 1
fi

SUBSCRIPTION_POLICY_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/subscription-policy.json" \
    --write-out '%{http_code}' \
    "$ENDPOINT/v1/subscriptions/policy" || true
)"
UNAUTH_COMPANION_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-companion.json" \
    --write-out '%{http_code}' \
    --request POST \
    --data '{}' \
    "$ENDPOINT/v1/companions/claim" || true
)"
UNAUTH_LEASE_CAPSULE_STATUS="$(
  curl --silent --show-error \
    --output "$STATE_DIR/unauthenticated-lease-capsule.json" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --data '{}' \
    "$ENDPOINT/v1/subscriptions/capsule-access" || true
)"
if [[ "$SUBSCRIPTION_POLICY_STATUS" != "200" || "$UNAUTH_COMPANION_STATUS" != "401" || "$UNAUTH_LEASE_CAPSULE_STATUS" != "401" ]]; then
  printf 'Subscription boundary failed (%s/%s/%s).\n' \
    "$SUBSCRIPTION_POLICY_STATUS" "$UNAUTH_COMPANION_STATUS" "$UNAUTH_LEASE_CAPSULE_STATUS" >&2
  exit 1
fi
SUBSCRIPTION_TEST_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
az functionapp function keys set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name companion_claim \
  --key-name private-subscription-test \
  --key-value="$SUBSCRIPTION_TEST_KEY" \
  --output none
COMPANION_NO_ACCOUNT_STATUS="000"
for _ in $(seq 1 6); do
  COMPANION_NO_ACCOUNT_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/companion-no-account.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header "x-functions-key: $SUBSCRIPTION_TEST_KEY" \
      --data '{}' \
      "$ENDPOINT/v1/companions/claim" || true
  )"
  if [[ "$COMPANION_NO_ACCOUNT_STATUS" == "403" ]]; then break; fi
  sleep 5
done
unset SUBSCRIPTION_TEST_KEY
az functionapp function keys delete \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name companion_claim \
  --key-name private-subscription-test \
  --output none
if [[ "$COMPANION_NO_ACCOUNT_STATUS" != "403" ]]; then
  printf 'Free Companion claim without account token was not refused (HTTP %s).\n' \
    "$COMPANION_NO_ACCOUNT_STATUS" >&2
  exit 1
fi

az functionapp function keys set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name purchase_redeem \
  --key-name private-stub-test \
  --output none
PURCHASE_KEY="$(
  az functionapp function keys list \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --function-name purchase_redeem \
    --query '"private-stub-test"' \
    --output tsv
)"
cat >"$STATE_DIR/untrusted-purchase.json" <<'JSON'
{
  "provider": "revenuecat",
  "receipt": "deliberately-invalid-private-smoke-receipt",
  "product_id": "rapter_hatch_1",
  "organism_rappid": "rappid:@smoke/rapter:test",
  "genesis_core_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "core_manifest_hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "payment_success": true
}
JSON
UNTRUSTED_PAYMENT_STATUS="000"
for _ in $(seq 1 6); do
  UNTRUSTED_PAYMENT_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/untrusted-purchase-response.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'content-type: application/json' \
      --header "x-functions-key: $PURCHASE_KEY" \
      --data-binary "@$STATE_DIR/untrusted-purchase.json" \
      "$ENDPOINT/v1/purchases/redeem" || true
  )"
  if [[ "$UNTRUSTED_PAYMENT_STATUS" == "400" ]]; then break; fi
  sleep 5
done
unset PURCHASE_KEY
az functionapp function keys delete \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name purchase_redeem \
  --key-name private-stub-test \
  --output none
if [[ "$UNTRUSTED_PAYMENT_STATUS" != "400" ]]; then
  printf 'Client-declared payment success was not rejected (HTTP %s).\n' \
    "$UNTRUSTED_PAYMENT_STATUS" >&2
  exit 1
fi

MODEL_KEY_VALUE="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
az functionapp function keys set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name openai_models \
  --key-name private-test \
  --key-value="$MODEL_KEY_VALUE" \
  --output none
az functionapp function keys set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --function-name openai_chat \
  --key-name private-test \
  --key-value="$MODEL_KEY_VALUE" \
  --output none
unset MODEL_KEY_VALUE
FUNCTION_KEY="$(
  az functionapp function keys list \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --function-name openai_models \
    --query '"private-test"' \
    --output tsv
)"
if [[ -z "$FUNCTION_KEY" ]]; then
  printf 'Could not retrieve the function-scoped private-test key.\n' >&2
  exit 1
fi

MODEL_AUTH_STATUS="000"
for _ in $(seq 1 12); do
  MODEL_AUTH_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/authenticated-models.json" \
      --write-out '%{http_code}' \
      --header "x-functions-key: $FUNCTION_KEY" \
      "$ENDPOINT/v1/models" || true
  )"
  if [[ "$MODEL_AUTH_STATUS" == "200" ]]; then break; fi
  sleep 5
done
if [[ "$MODEL_AUTH_STATUS" != "200" ]]; then
  unset FUNCTION_KEY
  printf 'Function-scoped model key did not become active (HTTP %s).\n' \
    "$MODEL_AUTH_STATUS" >&2
  exit 1
fi

security add-generic-password \
  -U \
  -s "$SERVICE" \
  -a "$PROFILE_ID" \
  -w "$FUNCTION_KEY" \
  >/dev/null 2>&1

(cd "$REPO_ROOT" && node --input-type=module <<NODE
import { writeFileSync } from "node:fs";
import { BreathingController } from "./desktop/breathing-controller.mjs";
import { OpenAICompatibleClient } from "./desktop/openai-compatible-client.mjs";
import { ProviderStore } from "./desktop/provider-store.mjs";
const store = new ProviderStore();
await store.save({
  profile: {
    id: "$PROFILE_ID",
    base_url: "$ENDPOINT",
    model: "gpt-5.4",
    auth_kind: "x-functions-key",
    headers: {},
    timeouts: { connect_ms: 5000, request_ms: 60000 }
  }
});
const client = new OpenAICompatibleClient({ store });
const result = await client.test({ id: "$PROFILE_ID" });
const breathing = new BreathingController({
  store,
  tick: async () => ({ advanced: false })
});
breathing.markVerified("$PROFILE_ID", result);
const breath = await breathing.status();
writeFileSync("$STATE_DIR/provider-test.json", JSON.stringify(result));
writeFileSync("$STATE_DIR/direct-breath-status.json", JSON.stringify(breath));
NODE
)

cat >"$STATE_DIR/request.json" <<'JSON'
{
  "model": "gpt-5.4",
  "messages": [
    {
      "role": "user",
      "content": "Reply with exactly OK"
    }
  ],
  "max_completion_tokens": 32
}
JSON

COMPLETION_STATUS="000"
for _ in $(seq 1 12); do
  COMPLETION_STATUS="$(
    curl --silent --show-error \
      --output "$STATE_DIR/completion.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'content-type: application/json' \
      --header "x-functions-key: $FUNCTION_KEY" \
      --data-binary "@$STATE_DIR/request.json" \
      "$ENDPOINT/v1/chat/completions" || true
  )"
  if [[ "$COMPLETION_STATUS" == "200" ]]; then break; fi
  sleep 15
done
unset FUNCTION_KEY
if [[ "$COMPLETION_STATUS" != "200" ]]; then
  printf 'Authenticated completion smoke failed with HTTP %s\n' "$COMPLETION_STATUS" >&2
  exit 1
fi

APP_DIR="$APP_DIR" \
FUNCTION_APP="$FUNCTION_APP" \
STORAGE_ACCOUNT="$STORAGE_ACCOUNT" \
TABLE_NAME="$TABLE_NAME" \
KEY_VAULT="$KEY_VAULT" \
SIGNING_KEY="$SIGNING_KEY" \
PROFILE_ID="$PROFILE_ID" \
HEALTH_STATUS="$HEALTH_STATUS" \
UNAUTH_STATUS="$UNAUTH_STATUS" \
QUOTE_STATUS="$QUOTE_STATUS" \
ISSUER_STATUS="$ISSUER_STATUS" \
REGISTRY_STATUS="$REGISTRY_STATUS" \
SCHEDULE_STATUS="$SCHEDULE_STATUS" \
UNAUTH_REDEEM_STATUS="$UNAUTH_REDEEM_STATUS" \
UNAUTH_CAPSULE_STATUS="$UNAUTH_CAPSULE_STATUS" \
UNAUTH_SCHEDULE_STATUS="$UNAUTH_SCHEDULE_STATUS" \
UNAUTH_BREATH_STATUS="$UNAUTH_BREATH_STATUS" \
WILD_STATUS="$WILD_STATUS" \
WILD_START_STATUS="$WILD_START_STATUS" \
WILD_PAUSE_STATUS="$WILD_PAUSE_STATUS" \
LIFECYCLE_STATUS="$LIFECYCLE_STATUS" \
UNAUTH_RETURN_STATUS="$UNAUTH_RETURN_STATUS" \
UNAUTH_LISTING_STATUS="$UNAUTH_LISTING_STATUS" \
RETURN_NO_OWNER_STATUS="$RETURN_NO_OWNER_STATUS" \
LISTING_NO_OWNER_STATUS="$LISTING_NO_OWNER_STATUS" \
ARTIFACT_STATUS="$ARTIFACT_STATUS" \
UNAUTH_ARTIFACT_STATUS="$UNAUTH_ARTIFACT_STATUS" \
ARTIFACT_NO_TOKEN_STATUS="$ARTIFACT_NO_TOKEN_STATUS" \
SUBSCRIPTION_POLICY_STATUS="$SUBSCRIPTION_POLICY_STATUS" \
UNAUTH_COMPANION_STATUS="$UNAUTH_COMPANION_STATUS" \
UNAUTH_LEASE_CAPSULE_STATUS="$UNAUTH_LEASE_CAPSULE_STATUS" \
COMPANION_NO_ACCOUNT_STATUS="$COMPANION_NO_ACCOUNT_STATUS" \
UNTRUSTED_PAYMENT_STATUS="$UNTRUSTED_PAYMENT_STATUS" \
COMPLETION_STATUS="$COMPLETION_STATUS" \
python3 <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

app_dir = Path(os.environ["APP_DIR"])
completion = json.loads((app_dir / ".deploy" / "completion.json").read_text())
provider_test = json.loads((app_dir / ".deploy" / "provider-test.json").read_text())
direct_breath = json.loads((app_dir / ".deploy" / "direct-breath-status.json").read_text())
issuer = json.loads((app_dir / ".deploy" / "credit-issuer.json").read_text())
registry = json.loads((app_dir / ".deploy" / "credit-list.json").read_text())
schedules = json.loads((app_dir / ".deploy" / "valuation-schedules.json").read_text())
wild_breathing = json.loads((app_dir / ".deploy" / "wild-breathing-status.json").read_text())
wild_pause = json.loads((app_dir / ".deploy" / "wild-breathing-pause.json").read_text())
lifecycle = json.loads((app_dir / ".deploy" / "lifecycle-status.json").read_text())
artifact = json.loads((app_dir / ".deploy" / "artifact-status.json").read_text())
subscription = json.loads((app_dir / ".deploy" / "subscription-policy.json").read_text())
if issuer.get("signing_ready") is not True:
    raise SystemExit("Key Vault signing self-test was not ready.")
if artifact.get("entitlement_verifier_configured") is not False:
    raise SystemExit("Artifact entitlement verifier did not fail closed.")
if artifact.get("commit_pin_required") is not True:
    raise SystemExit("Artifact policy did not require commit-pinned raw URLs.")
if subscription.get("free_companions_per_verified_account") != 1:
    raise SystemExit("Subscription policy did not enforce one free Companion.")
if subscription.get("exclusive_active_lessee") is not True:
    raise SystemExit("Subscription policy did not enforce exclusive leasing.")
if (
    subscription.get("canonical_genesis_families") != 151
    or subscription.get("free_companion_families") != 3
    or subscription.get("premium_families") != 148
):
    raise SystemExit("Subscription policy did not expose the canonical family split.")
choice = completion["choices"][0]
message = choice.get("message", {})
content = message.get("content")
if content != "OK":
    raise SystemExit("Completion body did not contain the expected sanitized result.")
evidence = f"""# Deployment evidence

- Verified: {datetime.now(timezone.utc).isoformat(timespec="seconds")}
- Function app: `{os.environ["FUNCTION_APP"]}`
- Endpoint: `https://{os.environ["FUNCTION_APP"]}.azurewebsites.net`
- Credit table: `{os.environ["STORAGE_ACCOUNT"]}` / `{os.environ["TABLE_NAME"]}`
- Signing key: `{os.environ["KEY_VAULT"]}` / `{os.environ["SIGNING_KEY"]}`
- `GET /health`: HTTP {os.environ["HEALTH_STATUS"]}, status `ok`
- Unauthenticated `GET /v1/models`: HTTP {os.environ["UNAUTH_STATUS"]} (refused)
- Desktop provider profile test: HTTP {provider_test["status"]}, configured model available
- Direct breath key: eligible, bounded, and `paused` until explicit opt-in
- Authenticated `POST /v1/chat/completions`: HTTP {os.environ["COMPLETION_STATUS"]}
- Hosting: Linux Consumption (`Y1` Dynamic)
- Public valuation schedules: HTTP {os.environ["SCHEDULE_STATUS"]}, {len(schedules["data"])} published schedules
- Birth valuation quote without a schedule: HTTP {os.environ["QUOTE_STATUS"]} (refused)
- Public issuer key: HTTP {os.environ["ISSUER_STATUS"]}, `{issuer["algorithm"]}` / `{issuer["jwk"]["crv"]}`, signing ready
- Public append-only registry: HTTP {os.environ["REGISTRY_STATUS"]}, {len(registry["data"])} issued credits
- Unauthenticated purchase redemption: HTTP {os.environ["UNAUTH_REDEEM_STATUS"]} (refused)
- Unauthenticated capsule authorization: HTTP {os.environ["UNAUTH_CAPSULE_STATUS"]} (refused)
- Unauthenticated valuation publication: HTTP {os.environ["UNAUTH_SCHEDULE_STATUS"]} (refused)
- Unauthenticated Wild breathing status: HTTP {os.environ["UNAUTH_BREATH_STATUS"]} (refused)
- Wild breath eligibility: HTTP {os.environ["WILD_STATUS"]}, disabled until scoped token + prepaid ledger + worker
- Wild start without scoped token: HTTP {os.environ["WILD_START_STATUS"]} (refused)
- Explicit Wild pause: HTTP {os.environ["WILD_PAUSE_STATUS"]}, state `Sleeping`
- Return/resale lifecycle: HTTP {os.environ["LIFECYCLE_STATUS"]}, 30-day window, immutable birth valuation
- Unauthenticated return/listing: HTTP {os.environ["UNAUTH_RETURN_STATUS"]}/{os.environ["UNAUTH_LISTING_STATUS"]} (refused)
- Return/listing without scoped owner token: HTTP {os.environ["RETURN_NO_OWNER_STATUS"]}/{os.environ["LISTING_NO_OWNER_STATUS"]} (refused)
- Artifact delivery policy: HTTP {os.environ["ARTIFACT_STATUS"]}, commit pin required, entitlement adapter disabled
- Artifact release without Function/scoped token: HTTP {os.environ["UNAUTH_ARTIFACT_STATUS"]}/{os.environ["ARTIFACT_NO_TOKEN_STATUS"]} (refused)
- Subscription policy: HTTP {os.environ["SUBSCRIPTION_POLICY_STATUS"]}, 151 families (3 free / 148 premium), one free Companion/account, exclusive premium lessee
- Companion claim without Function/account token: HTTP {os.environ["UNAUTH_COMPANION_STATUS"]}/{os.environ["COMPANION_NO_ACCOUNT_STATUS"]} (refused)
- Lease Capsule access without Function token: HTTP {os.environ["UNAUTH_LEASE_CAPSULE_STATUS"]} (refused)
- Client-declared payment success: HTTP {os.environ["UNTRUSTED_PAYMENT_STATUS"]} (rejected)
- Completion shape: `{completion.get("object")}`
- Completion model: `{completion.get("model", "gpt-5.4")}`
- Completion finish reason: `{choice.get("finish_reason")}`
- Sanitized completion content: `OK`
- Keychain service/account: `com.rapterbox.rollingcores.openai-compatible` / `{os.environ["PROFILE_ID"]}`

No credential value is recorded in this file.
"""
(app_dir / "DEPLOYMENT_EVIDENCE.md").write_text(evidence)
PY

printf 'Health: HTTP %s\n' "$HEALTH_STATUS"
printf 'Unauthenticated models: HTTP %s\n' "$UNAUTH_STATUS"
printf 'Authenticated completion: HTTP %s, content OK\n' "$COMPLETION_STATUS"
printf 'Schedules/quote/issuer/registry: HTTP %s/%s/%s/%s\n' \
  "$SCHEDULE_STATUS" "$QUOTE_STATUS" "$ISSUER_STATUS" "$REGISTRY_STATUS"
printf 'Unauthenticated redeem/capsule/schedule: HTTP %s/%s/%s\n' \
  "$UNAUTH_REDEEM_STATUS" "$UNAUTH_CAPSULE_STATUS" "$UNAUTH_SCHEDULE_STATUS"
printf 'Client-declared payment success: HTTP %s rejected\n' \
  "$UNTRUSTED_PAYMENT_STATUS"
printf 'Wild breathing status/start/pause: HTTP %s/%s/%s\n' \
  "$WILD_STATUS" "$WILD_START_STATUS" "$WILD_PAUSE_STATUS"
printf 'Lifecycle status/return/listing: HTTP %s/%s/%s\n' \
  "$LIFECYCLE_STATUS" "$UNAUTH_RETURN_STATUS" "$UNAUTH_LISTING_STATUS"
printf 'Lifecycle missing-owner return/listing: HTTP %s/%s\n' \
  "$RETURN_NO_OWNER_STATUS" "$LISTING_NO_OWNER_STATUS"
printf 'Artifact status/unauth/no-token: HTTP %s/%s/%s\n' \
  "$ARTIFACT_STATUS" "$UNAUTH_ARTIFACT_STATUS" "$ARTIFACT_NO_TOKEN_STATUS"
printf 'Subscription policy/unauth/no-account: HTTP %s/%s/%s\n' \
  "$SUBSCRIPTION_POLICY_STATUS" "$UNAUTH_COMPANION_STATUS" "$COMPANION_NO_ACCOUNT_STATUS"
printf 'Keychain: %s / %s\n' "$SERVICE" "$PROFILE_ID"
