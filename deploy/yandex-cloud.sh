#!/usr/bin/env bash
set -euo pipefail

if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

: "${LLM_RELAY_URL:?Set LLM_RELAY_URL in .env.local}"
: "${LLM_RELAY_TOKEN:?Set LLM_RELAY_TOKEN in .env.local}"

REGISTRY_NAME="${REGISTRY_NAME:-pobeg-po-alibi}"
CONTAINER_NAME="${CONTAINER_NAME:-pobeg-po-alibi}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-pobeg-po-alibi-runtime}"
YC_BIN="${YC_BIN:-/Users/denis/.local/yandex-cloud/bin/yc}"
export PATH="$(dirname "$YC_BIN"):$PATH"

registry_json=""
if registry_json="$($YC_BIN container registry get --name "$REGISTRY_NAME" --format json 2>/dev/null)"; then
  registry_id="$(printf '%s' "$registry_json" | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | head -1)"
else
  registry_id="$($YC_BIN container registry create --name "$REGISTRY_NAME" --format json | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | head -1)"
fi

$YC_BIN container registry configure-docker
image="cr.yandex/${registry_id}/pobeg-po-alibi:${IMAGE_TAG}"
docker build --platform linux/amd64 -t "$image" .
docker push "$image"

if ! $YC_BIN serverless container get --name "$CONTAINER_NAME" >/dev/null 2>&1; then
  $YC_BIN serverless container create --name "$CONTAINER_NAME"
fi

service_account_json=""
if service_account_json="$($YC_BIN iam service-account get --name "$SERVICE_ACCOUNT_NAME" --format json 2>/dev/null)"; then
  service_account_id="$(printf '%s' "$service_account_json" | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | head -1)"
else
  service_account_id="$($YC_BIN iam service-account create --name "$SERVICE_ACCOUNT_NAME" --format json | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | head -1)"
fi

folder_id="$($YC_BIN config get folder-id)"
$YC_BIN resource-manager folder add-access-binding "$folder_id" \
  --role container-registry.images.puller \
  --subject "serviceAccount:${service_account_id}" >/dev/null

$YC_BIN serverless container revision deploy \
  --container-name "$CONTAINER_NAME" \
  --image "$image" \
  --service-account-id "$service_account_id" \
  --cores 1 \
  --memory 1GB \
  --concurrency 4 \
  --execution-timeout 75s \
  --environment "LLM_RELAY_URL=${LLM_RELAY_URL}" \
  --environment "LLM_RELAY_TOKEN=${LLM_RELAY_TOKEN}"

$YC_BIN serverless container allow-unauthenticated-invoke "$CONTAINER_NAME"
$YC_BIN serverless container get --name "$CONTAINER_NAME" --format json
