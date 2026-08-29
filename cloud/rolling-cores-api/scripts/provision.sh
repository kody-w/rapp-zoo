#!/usr/bin/env bash
set -euo pipefail

SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-3d0e6986-1b31-4189-a394-b3289d54efb0}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rappter_ai}"
LOCATION="${AZURE_LOCATION:-eastus}"
AI_ACCOUNT="${AZURE_OPENAI_ACCOUNT:-rappter}"
FUNCTION_APP="${ROLLING_CORES_FUNCTION_APP:-rappter-rolling-cores-3d0e6986}"
STORAGE_ACCOUNT="${ROLLING_CORES_STORAGE_ACCOUNT:-rapprolling3d0e6986}"
KEY_VAULT="${ROLLING_CORES_KEY_VAULT:-rappter-credit-3d0e6986}"
SIGNING_KEY="${ROLLING_CORES_SIGNING_KEY:-credit-registry-signing-v1}"
TABLE_NAME="${ROLLING_CORES_TABLE_NAME:-RapterCreditRegistry}"
DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-gpt-5.4}"
API_VERSION="${AZURE_OPENAI_API_VERSION:-2025-04-01-preview}"

az account set --subscription "$SUBSCRIPTION_ID"

if ! az storage account show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$STORAGE_ACCOUNT" \
  --output none 2>/dev/null; then
  az storage account create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$STORAGE_ACCOUNT" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --min-tls-version TLS1_2 \
    --allow-blob-public-access false \
    --output none
fi

if ! az functionapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --output none 2>/dev/null; then
  az functionapp create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --storage-account "$STORAGE_ACCOUNT" \
    --consumption-plan-location "$LOCATION" \
    --os-type Linux \
    --runtime python \
    --runtime-version 3.11 \
    --functions-version 4 \
    --disable-app-insights true \
    --output none
fi

az functionapp update \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --set httpsOnly=true clientAffinityEnabled=false \
  --output none
az functionapp config set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --min-tls-version 1.2 \
  --ftps-state Disabled \
  --output none

PRINCIPAL_ID="$(
  az functionapp identity assign \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --query principalId \
    --output tsv
)"
AI_SCOPE="$(
  az cognitiveservices account show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AI_ACCOUNT" \
    --query id \
    --output tsv
)"
STORAGE_SCOPE="$(
  az storage account show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$STORAGE_ACCOUNT" \
    --query id \
    --output tsv
)"

if ! az role assignment list \
  --assignee "$PRINCIPAL_ID" \
  --scope "$AI_SCOPE" \
  --role "Cognitive Services OpenAI User" \
  --query '[0].id' \
  --output tsv | grep -q .; then
  az role assignment create \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Cognitive Services OpenAI User" \
    --scope "$AI_SCOPE" \
    --output none
fi

if ! az role assignment list \
  --assignee "$PRINCIPAL_ID" \
  --scope "$STORAGE_SCOPE" \
  --role "Storage Table Data Contributor" \
  --query '[0].id' \
  --output tsv | grep -q .; then
  az role assignment create \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Storage Table Data Contributor" \
    --scope "$STORAGE_SCOPE" \
    --output none
fi

if ! az keyvault show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$KEY_VAULT" \
  --output none 2>/dev/null; then
  az keyvault create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$KEY_VAULT" \
    --location "$LOCATION" \
    --sku standard \
    --enable-rbac-authorization true \
    --retention-days 7 \
    --output none
fi
az keyvault update \
  --resource-group "$RESOURCE_GROUP" \
  --name "$KEY_VAULT" \
  --enable-purge-protection true \
  --output none
KEY_VAULT_SCOPE="$(
  az keyvault show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$KEY_VAULT" \
    --query id \
    --output tsv
)"
if ! az role assignment list \
  --assignee "$PRINCIPAL_ID" \
  --scope "$KEY_VAULT_SCOPE" \
  --role "Key Vault Crypto User" \
  --query '[0].id' \
  --output tsv | grep -q .; then
  az role assignment create \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "Key Vault Crypto User" \
    --scope "$KEY_VAULT_SCOPE" \
    --output none
fi

if ! az keyvault key show \
  --vault-name "$KEY_VAULT" \
  --name "$SIGNING_KEY" \
  --output none 2>/dev/null; then
  CURRENT_USER_OBJECT_ID="$(az ad signed-in-user show --query id --output tsv)"
  if ! az role assignment list \
    --assignee "$CURRENT_USER_OBJECT_ID" \
    --scope "$KEY_VAULT_SCOPE" \
    --role "Key Vault Crypto Officer" \
    --query '[0].id' \
    --output tsv | grep -q .; then
    az role assignment create \
      --assignee-object-id "$CURRENT_USER_OBJECT_ID" \
      --assignee-principal-type User \
      --role "Key Vault Crypto Officer" \
      --scope "$KEY_VAULT_SCOPE" \
      --output none
  fi
  for _ in $(seq 1 18); do
    if az keyvault key create \
      --vault-name "$KEY_VAULT" \
      --name "$SIGNING_KEY" \
      --kty EC \
      --curve P-256 \
      --ops sign verify \
      --output none 2>/dev/null; then
      break
    fi
    sleep 10
  done
  az keyvault key show \
    --vault-name "$KEY_VAULT" \
    --name "$SIGNING_KEY" \
    --output none
fi

AZURE_OPENAI_ENDPOINT="$(
  az cognitiveservices account show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AI_ACCOUNT" \
    --query properties.endpoint \
    --output tsv
)"
az functionapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --settings \
    "AZURE_OPENAI_ENDPOINT=$AZURE_OPENAI_ENDPOINT" \
    "AZURE_OPENAI_DEPLOYMENT=$DEPLOYMENT" \
    "AZURE_OPENAI_API_VERSION=$API_VERSION" \
    "MAX_OUTPUT_TOKENS=256" \
    "MAX_REQUEST_BYTES=65536" \
    "MAX_MESSAGES=32" \
    "MAX_MESSAGE_CHARS=12000" \
    "MAX_TOTAL_MESSAGE_CHARS=32000" \
    "UPSTREAM_CONNECT_TIMEOUT_SECONDS=5" \
    "UPSTREAM_TIMEOUT_SECONDS=45" \
    "CREDIT_TABLE_ACCOUNT_URL=https://$STORAGE_ACCOUNT.table.core.windows.net" \
    "CREDIT_TABLE_NAME=$TABLE_NAME" \
    "CREDIT_KEY_VAULT_URL=https://$KEY_VAULT.vault.azure.net" \
    "CREDIT_SIGNING_KEY_NAME=$SIGNING_KEY" \
    "CREDIT_ISSUER_ID=rappterbox" \
    "CREDIT_ISSUANCE_CAP=1000000" \
    "BTC_QUOTE_MAX_AGE_SECONDS=120" \
    "WILD_BREATH_MIN_INTERVAL_SECONDS=300" \
    "WILD_BREATH_MAX_TICKS_PER_LEASE=12" \
    "WILD_BREATH_MAX_OUTPUT_TOKENS_PER_TICK=512" \
    "WILD_BREATH_MAX_TOTAL_OUTPUT_TOKENS=6144" \
    "WILD_BREATH_MAX_LEASE_SECONDS=86400" \
    "BITCOIN_REFUND_FEE_SATS=0" \
    "CREDIT_PRODUCTS_JSON={}" \
    "PURCHASE_VERIFIER_MODE=disabled" \
  --output none

printf 'Function app: %s\n' "$FUNCTION_APP"
printf 'Storage account: %s\n' "$STORAGE_ACCOUNT"
printf 'Credit table: %s\n' "$TABLE_NAME"
printf 'Key Vault: %s\n' "$KEY_VAULT"
printf 'Signing key: %s\n' "$SIGNING_KEY"
printf 'Endpoint: https://%s.azurewebsites.net\n' "$FUNCTION_APP"
printf 'Identity role: Cognitive Services OpenAI User at %s\n' "$AI_SCOPE"
