#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-3d0e6986-1b31-4189-a394-b3289d54efb0}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rappter_ai}"
FUNCTION_APP="${ROLLING_CORES_FUNCTION_APP:-rappter-rolling-cores-3d0e6986}"
BUILD_DIR="$APP_DIR/.deploy/package"
ZIP_PATH="$APP_DIR/.deploy/rolling-cores-api.zip"
PIP_TEMP="$APP_DIR/.deploy/pip-tmp"

az account set --subscription "$SUBSCRIPTION_ID"
rm -rf "$APP_DIR/.deploy"
mkdir -p "$BUILD_DIR"
cp \
  "$APP_DIR/function_app.py" \
  "$APP_DIR/model_gateway.py" \
  "$APP_DIR/breathing.py" \
  "$APP_DIR/azure_auth.py" \
  "$APP_DIR/http_responses.py" \
  "$APP_DIR/host.json" \
  "$APP_DIR/requirements.txt" \
  "$BUILD_DIR/"
cp -R "$APP_DIR/credits" "$BUILD_DIR/credits"
cp -R "$APP_DIR/artifacts" "$BUILD_DIR/artifacts"
find "$BUILD_DIR/credits" "$BUILD_DIR/artifacts" \
  -type d -name __pycache__ -prune -exec rm -rf {} +
mkdir -p "$PIP_TEMP"
TMPDIR="$PIP_TEMP" python3 -m pip install \
  --quiet \
  --disable-pip-version-check \
  --requirement "$APP_DIR/requirements.txt" \
  --target "$BUILD_DIR/.python_packages/lib/site-packages" \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.11 \
  --only-binary=:all:
(cd "$BUILD_DIR" && zip -q -r "$ZIP_PATH" .)

az functionapp deployment source config-zip \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --src "$ZIP_PATH" \
  --build-remote false \
  --timeout 900 \
  --output none

FUNCTION_APP_ID="$(
  az functionapp show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --query id \
    --output tsv
)"
az rest \
  --method post \
  --url "https://management.azure.com${FUNCTION_APP_ID}/syncfunctiontriggers?api-version=2022-03-01" \
  --output none

printf 'Deployed https://%s.azurewebsites.net\n' "$FUNCTION_APP"
