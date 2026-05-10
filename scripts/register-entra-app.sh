#!/usr/bin/env bash
# =============================================================================
# register-entra-app.sh
#
# Automates Entra ID app registration for the foundry-observability app.
#
# Auth options:
#   1) az login  — interactive browser sign-in (personal / user account)
#   2) Service Principal — non-interactive CI/CD use (appId + secret + tenant)
#
# What it does:
#   - Creates (or reuses) an Entra ID App Registration
#   - Adds required redirect URIs (localhost + Container Apps)
#   - Grants delegated Azure Management API permission
#   - Enables the implicit-grant ID-token flow for MSAL SPA
#   - Writes AZURE_CLIENT_ID and AZURE_TENANT_ID into .env (or .env.example)
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
die()     { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     Foundry Observability — Entra ID App Registration    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v az  >/dev/null 2>&1 || die "Azure CLI (az) is not installed. Install it from https://aka.ms/install-azure-cli"
command -v jq  >/dev/null 2>&1 || die "jq is not installed.  brew install jq  |  apt install jq"

# ── Script directory (repo root is one level up) ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"

# ── Constants ─────────────────────────────────────────────────────────────────
APP_DISPLAY_NAME="foundry-observability"
# Azure Management API (ARM) — delegated permission: user_impersonation
ARM_APP_ID="797f4846-ba00-4fd7-ba43-dac1f8f63013"
ARM_USER_IMPERSONATION_SCOPE_ID="41094075-9dad-400e-a0bd-54e686782033"

# ── Step 1: Choose authentication method ─────────────────────────────────────
echo -e "${BOLD}Authentication method${RESET}"
echo "  1) az login  (interactive browser sign-in)"
echo "  2) Service Principal  (client ID + secret, for CI/CD)"
echo ""
read -rp "Enter choice [1/2]: " AUTH_CHOICE

case "${AUTH_CHOICE}" in
  1)
    info "Launching interactive browser sign-in…"
    az login --only-show-errors --output none
    TENANT_ID=$(az account show --query tenantId -o tsv)
    success "Signed in. Tenant: ${TENANT_ID}"
    ;;
  2)
    echo ""
    read -rp "  SP Client ID    : " SP_CLIENT_ID
    read -rsp "  SP Client Secret: " SP_CLIENT_SECRET; echo ""
    read -rp "  Tenant ID       : " TENANT_ID
    info "Authenticating as Service Principal…"
    az login \
      --service-principal \
      --username  "${SP_CLIENT_ID}" \
      --password  "${SP_CLIENT_SECRET}" \
      --tenant    "${TENANT_ID}" \
      --only-show-errors \
      --output none
    success "Authenticated. Tenant: ${TENANT_ID}"
    ;;
  *)
    die "Invalid choice '${AUTH_CHOICE}'. Run the script again and enter 1 or 2."
    ;;
esac

# ── Step 2: Optional Container Apps redirect URI ──────────────────────────────
echo ""
echo -e "${BOLD}Redirect URIs${RESET}"
echo "  http://localhost:8004  will always be added (local dev)."
read -rp "  Container Apps hostname (leave blank to skip, e.g. myapp.azurecontainerapps.io): " CA_HOST

REDIRECT_URIS=("http://localhost:8004")
if [[ -n "${CA_HOST}" ]]; then
  # Strip trailing slash / protocol if user pastes a full URL
  CA_HOST="${CA_HOST#https://}"
  CA_HOST="${CA_HOST#http://}"
  CA_HOST="${CA_HOST%/}"
  REDIRECT_URIS+=("https://${CA_HOST}")
fi

# ── Step 3: Check whether the app already exists ──────────────────────────────
echo ""
info "Checking whether '${APP_DISPLAY_NAME}' already exists in Entra ID…"
EXISTING_APP_ID=$(az ad app list \
  --display-name "${APP_DISPLAY_NAME}" \
  --query "[0].appId" -o tsv 2>/dev/null || true)

if [[ -n "${EXISTING_APP_ID}" && "${EXISTING_APP_ID}" != "None" ]]; then
  warn "App '${APP_DISPLAY_NAME}' already exists (appId: ${EXISTING_APP_ID})."
  read -rp "  Use existing app? [Y/n]: " USE_EXISTING
  USE_EXISTING=$(echo "${USE_EXISTING:-Y}" | tr '[:upper:]' '[:lower:]')
  if [[ "${USE_EXISTING}" == "y" ]]; then
    CLIENT_ID="${EXISTING_APP_ID}"
    info "Reusing existing app registration."
  else
    APP_DISPLAY_NAME="${APP_DISPLAY_NAME}-$(date +%Y%m%d%H%M%S)"
    warn "Creating new app with name '${APP_DISPLAY_NAME}' to avoid conflict."
    EXISTING_APP_ID=""
  fi
fi

# ── Step 4: Create the app registration (if needed) ───────────────────────────
if [[ -z "${EXISTING_APP_ID:-}" || "${USE_EXISTING:-y}" != "y" ]]; then
  info "Creating app registration '${APP_DISPLAY_NAME}'…"

  # Build SPA redirect URI JSON array
  SPA_URIS_JSON=$(printf '%s\n' "${REDIRECT_URIS[@]}" | jq -R . | jq -s .)

  # Create the application
  APP_JSON=$(az ad app create \
    --display-name  "${APP_DISPLAY_NAME}" \
    --sign-in-audience "AzureADMyOrg" \
    --output json)

  CLIENT_ID=$(echo "${APP_JSON}" | jq -r '.appId')
  OBJECT_ID=$(echo "${APP_JSON}" | jq -r '.id')
  success "App created — appId: ${CLIENT_ID}  objectId: ${OBJECT_ID}"
else
  OBJECT_ID=$(az ad app show --id "${CLIENT_ID}" --query id -o tsv)
fi

# ── Step 5: Configure SPA redirect URIs ───────────────────────────────────────
info "Configuring SPA redirect URIs…"
SPA_URIS_JSON=$(printf '%s\n' "${REDIRECT_URIS[@]}" | jq -R . | jq -s '{"redirectUris": .}')

az rest \
  --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/${OBJECT_ID}" \
  --headers "Content-Type=application/json" \
  --body "{\"spa\": ${SPA_URIS_JSON}}" \
  --output none

for uri in "${REDIRECT_URIS[@]}"; do
  success "  + ${uri}"
done

# ── Step 6: Enable ID-token implicit grant (needed for MSAL popup) ─────────────
info "Enabling ID-token implicit grant…"
az rest \
  --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/${OBJECT_ID}" \
  --headers "Content-Type=application/json" \
  --body '{"implicitGrantSettings": {"enableIdTokenIssuance": true, "enableAccessTokenIssuance": false}}' \
  --output none
success "ID-token implicit grant enabled."

# ── Step 7: Add delegated Azure Management API permission ─────────────────────
info "Adding delegated Azure Management (user_impersonation) permission…"

# Check if permission already present
EXISTING_PERMS=$(az ad app show --id "${CLIENT_ID}" \
  --query "requiredResourceAccess[?resourceAppId=='${ARM_APP_ID}'].resourceAccess[].id" \
  -o tsv 2>/dev/null || true)

if echo "${EXISTING_PERMS}" | grep -q "${ARM_USER_IMPERSONATION_SCOPE_ID}"; then
  warn "Permission already configured, skipping."
else
  REQUIRED_RESOURCE_ACCESS=$(cat <<JSON
[
  {
    "resourceAppId": "${ARM_APP_ID}",
    "resourceAccess": [
      {
        "id": "${ARM_USER_IMPERSONATION_SCOPE_ID}",
        "type": "Scope"
      }
    ]
  }
]
JSON
)
  az ad app update \
    --id "${CLIENT_ID}" \
    --required-resource-accesses "${REQUIRED_RESOURCE_ACCESS}" \
    --output none
  success "Azure Management user_impersonation permission added."
  warn "A Global Admin must grant admin consent if users cannot consent themselves:"
  warn "  az ad app permission admin-consent --id ${CLIENT_ID}"
fi

# ── Step 8: Create a service principal if it doesn't exist ───────────────────
info "Ensuring service principal exists for the app…"
SP_ID=$(az ad sp show --id "${CLIENT_ID}" --query id -o tsv 2>/dev/null || true)
if [[ -z "${SP_ID}" || "${SP_ID}" == "None" ]]; then
  az ad sp create --id "${CLIENT_ID}" --output none
  success "Service principal created."
else
  success "Service principal already exists (${SP_ID})."
fi

# ── Step 9: Write values to .env ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}Update .env file${RESET}"
if [[ -f "${ENV_FILE}" ]]; then
  read -rp "  Update existing ${ENV_FILE}? [Y/n]: " UPDATE_ENV
  UPDATE_ENV="${UPDATE_ENV:-Y}"
else
  read -rp "  Create ${ENV_FILE} from .env.example? [Y/n]: " UPDATE_ENV
  UPDATE_ENV="${UPDATE_ENV:-Y}"
fi

UPDATE_ENV=$(echo "${UPDATE_ENV}" | tr '[:upper:]' '[:lower:]')
if [[ "${UPDATE_ENV}" == "y" ]]; then
  # Create .env from example if it doesn't exist
  if [[ ! -f "${ENV_FILE}" ]] && [[ -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    info "Created ${ENV_FILE} from .env.example"
  elif [[ ! -f "${ENV_FILE}" ]]; then
    touch "${ENV_FILE}"
  fi

  # Update or insert AZURE_CLIENT_ID
  if grep -q "^AZURE_CLIENT_ID=" "${ENV_FILE}"; then
    sed -i.bak "s|^AZURE_CLIENT_ID=.*|AZURE_CLIENT_ID=${CLIENT_ID}|" "${ENV_FILE}"
  else
    echo "AZURE_CLIENT_ID=${CLIENT_ID}" >> "${ENV_FILE}"
  fi

  # Update or insert AZURE_TENANT_ID
  if grep -q "^AZURE_TENANT_ID=" "${ENV_FILE}"; then
    sed -i.bak "s|^AZURE_TENANT_ID=.*|AZURE_TENANT_ID=${TENANT_ID}|" "${ENV_FILE}"
  else
    echo "AZURE_TENANT_ID=${TENANT_ID}" >> "${ENV_FILE}"
  fi

  # Clean up .bak files created by sed -i on macOS
  rm -f "${ENV_FILE}.bak"

  success ".env updated:"
  success "  AZURE_CLIENT_ID = ${CLIENT_ID}"
  success "  AZURE_TENANT_ID = ${TENANT_ID}"
else
  warn ".env not updated. Set these manually:"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║                     Registration Summary                 ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  App Display Name : ${BOLD}${APP_DISPLAY_NAME}${RESET}"
echo -e "  AZURE_CLIENT_ID  : ${GREEN}${CLIENT_ID}${RESET}"
echo -e "  AZURE_TENANT_ID  : ${GREEN}${TENANT_ID}${RESET}"
echo ""
echo "  Redirect URIs configured:"
for uri in "${REDIRECT_URIS[@]}"; do
  echo "    • ${uri}"
done
echo ""
echo "  API Permission : Azure Service Management — user_impersonation (delegated)"
echo ""
echo -e "${YELLOW}Next steps:${RESET}"
echo "  1. Grant admin consent (if needed):"
echo "     az ad app permission admin-consent --id ${CLIENT_ID}"
echo ""
echo "  2. Fill in APIM vars in .env:"
echo "     APIM_NAME, APIM_API_ID, APIM_BACKEND_ID, DEFAULT_TPM"
echo ""
echo "  3. Run the app:"
echo "     cd backend && .venv/bin/uvicorn main:app --port 8004"
echo ""
echo -e "${GREEN}Done.${RESET}"
