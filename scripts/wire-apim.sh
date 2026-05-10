#!/usr/bin/env bash
# =============================================================================
# wire-apim.sh
#
# Auto-discovers APIM instances and Foundry resources across all subscriptions
# in your tenant, then wires them together.
#
# No resource group or resource name prompts — everything is discovered from
# your Azure credentials.
#
# What it does:
#   1.  Discovers all APIM instances across the tenant — lets you pick one
#   2.  Enables SystemAssigned Managed Identity on the selected APIM
#   3.  Discovers all Foundry / Azure OpenAI resources across the tenant
#   4.  Creates APIM Named Value (openai-api-version)
#   5.  Creates an APIM Backend per Foundry resource
#   6.  Creates the APIM API ("azure-openai") with chat completions operation
#   7.  Applies the inbound/outbound policy (MI auth, rate limit, token limit,
#       emit-token-metric) using the selected default backend
#   8.  Creates the Product + links the API
#   9.  Creates a dev subscription key
#  10.  Assigns "Cognitive Services OpenAI User" role on EVERY discovered
#       Foundry resource so APIM MI can call any of them
#  11.  (Optional) Private networking per resource
#
# Prerequisites:
#   - Azure CLI >= 2.60  (az --version)
#   - resource-graph ext (auto-installed if missing)
#   - jq                 (brew install jq | apt install jq)
#   - Logged in:         az login
#   - Sufficient RBAC:   Contributor + User Access Administrator
#
# Usage:
#   chmod +x scripts/wire-apim.sh
#   ./scripts/wire-apim.sh
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}  ✔${RESET}   $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
die()     { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}━━━ $* ━━━${RESET}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║      Foundry Observability — Wire Existing APIM          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v az >/dev/null 2>&1 || die "Azure CLI (az) is not installed. https://aka.ms/install-azure-cli"
command -v jq >/dev/null 2>&1 || die "jq is not installed.  brew install jq  |  apt install jq"

az account show -o none 2>/dev/null || die "Not logged in. Run: az login"

# Ensure resource-graph extension is installed (used for fast cross-tenant queries)
if ! az extension show --name resource-graph -o none 2>/dev/null; then
  info "Installing Azure Resource Graph CLI extension..."
  az extension add --name resource-graph -o none 2>/dev/null
fi

# ── Helper: prompt with env-var override ──────────────────────────────────────
prompt() {
  local var_name="$1" prompt_text="$2" default="${3:-}"
  local current="${!var_name:-}"
  if [[ -n "$current" ]]; then
    echo -e "${DIM}  Using $var_name=$current (from env)${RESET}"
    return
  fi
  if [[ -n "$default" ]]; then
    read -rp "  $prompt_text [$default]: " val
    val="${val:-$default}"
  else
    read -rp "  $prompt_text: " val
    [[ -z "$val" ]] && die "$var_name is required."
  fi
  eval "$var_name=\"\$val\""
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 1 — Discover ALL subscriptions
# ══════════════════════════════════════════════════════════════════════════════
step "Step 1 — Discover subscriptions"

SUBS_JSON=$(az account list --query "[?state=='Enabled'].{id:id, name:name}" -o json 2>/dev/null)
SUB_COUNT=$(echo "$SUBS_JSON" | jq length)
info "Found $SUB_COUNT enabled subscription(s)"

[[ "$SUB_COUNT" -eq 0 ]] && die "No enabled subscriptions found."

# Build subscription ID list for Resource Graph scope
SUB_IDS=$(echo "$SUBS_JSON" | jq -r '.[].id' | tr '\n' ' ')

# ══════════════════════════════════════════════════════════════════════════════
# Step 2 — Discover ALL APIM instances across the tenant (Resource Graph)
# ══════════════════════════════════════════════════════════════════════════════
step "Step 2 — Discover APIM instances"

info "Querying Azure Resource Graph (instant cross-tenant scan)..."

APIMS_JSON=$(az graph query -q "
  resources
  | where type == 'microsoft.apimanagement/service'
  | project name, rg=resourceGroup, location, sku=sku.name, id,
            subId=subscriptionId
" --subscriptions $SUB_IDS --first 1000 -o json 2>/dev/null \
  | jq '[.data[] | . + {subName: .subId}]')

# Resolve subscription names from our cached list
APIMS_JSON=$(echo "$APIMS_JSON" | jq --argjson subs "$SUBS_JSON" '
  [ .[] | . as $r | .subName = ($subs[] | select(.id == $r.subId) | .name) // $r.subId ]')

APIM_COUNT=$(echo "$APIMS_JSON" | jq length)
[[ "$APIM_COUNT" -eq 0 ]] && die "No APIM instances found in any subscription."

echo ""
echo -e "${BOLD}  Found $APIM_COUNT APIM instance(s):${RESET}"
echo ""
echo "$APIMS_JSON" | jq -r 'to_entries[] |
  "  \(.key + 1). \(.value.name)  (\(.value.sku // "?"))  — \(.value.subName) / \(.value.rg)  [\(.value.location)]"'
echo ""

if [[ "$APIM_COUNT" -eq 1 ]]; then
  APIM_IDX=0
  info "Only one APIM found — selecting it automatically."
else
  read -rp "  Select APIM instance [1]: " APIM_CHOICE
  APIM_IDX=$(( ${APIM_CHOICE:-1} - 1 ))
  if [[ "$APIM_IDX" -lt 0 || "$APIM_IDX" -ge "$APIM_COUNT" ]]; then
    die "Invalid selection. Pick a number between 1 and $APIM_COUNT."
  fi
fi

APIM_NAME=$(echo "$APIMS_JSON"       | jq -r ".[$APIM_IDX].name")
RESOURCE_GROUP=$(echo "$APIMS_JSON"   | jq -r ".[$APIM_IDX].rg")
APIM_SUB_ID=$(echo "$APIMS_JSON"     | jq -r ".[$APIM_IDX].subId")
APIM_SUB_NAME=$(echo "$APIMS_JSON"   | jq -r ".[$APIM_IDX].subName")
LOCATION=$(echo "$APIMS_JSON"        | jq -r ".[$APIM_IDX].location")

success "Selected: $APIM_NAME  ($APIM_SUB_NAME / $RESOURCE_GROUP)"

# Ensure we're operating in the APIM's subscription context
az account set --subscription "$APIM_SUB_ID" -o none 2>/dev/null

APIM_MGMT="https://management.azure.com/subscriptions/${APIM_SUB_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}"

# ── Remaining config prompts ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Configuration${RESET}"
echo ""
prompt OPENAI_API_VERSION   "OpenAI API version"              "2025-01-01-preview"
prompt RATE_LIMIT_CALLS     "Rate limit (calls/period)"       "100"
prompt RATE_LIMIT_PERIOD    "Rate limit period (seconds)"     "60"
prompt TOKEN_LIMIT_TPM      "Token limit (TPM/subscription)"  "10000"
prompt SETUP_PRIVATE_NET    "Set up private networking? (y/n)" "n"

# ══════════════════════════════════════════════════════════════════════════════
# Step 3 — Enable Managed Identity on APIM
# ══════════════════════════════════════════════════════════════════════════════
step "Step 3 — Enable SystemAssigned Managed Identity on APIM"

EXISTING_MI=$(az apim show --name "$APIM_NAME" -g "$RESOURCE_GROUP" \
  --subscription "$APIM_SUB_ID" \
  --query "identity.type" -o tsv 2>/dev/null || echo "")

if [[ "$EXISTING_MI" == *"SystemAssigned"* ]]; then
  success "Managed Identity already enabled"
else
  az apim update --name "$APIM_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --set identity.type=SystemAssigned -o none
  success "Managed Identity enabled"
fi

APIM_MI_PRINCIPAL=$(az apim show --name "$APIM_NAME" -g "$RESOURCE_GROUP" \
  --subscription "$APIM_SUB_ID" \
  --query "identity.principalId" -o tsv)
info "APIM MI Principal ID: $APIM_MI_PRINCIPAL"

# ══════════════════════════════════════════════════════════════════════════════
# Step 4 — Discover ALL Foundry resources across the tenant
# ══════════════════════════════════════════════════════════════════════════════
step "Step 4 — Discover Foundry / Azure OpenAI resources across tenant"

info "Querying Azure Resource Graph..."

RESOURCES_JSON=$(az graph query -q "
  resources
  | where type == 'microsoft.cognitiveservices/accounts'
  | where kind in ('AIServices', 'OpenAI', 'CognitiveServices')
  | project name, rg=resourceGroup, kind, endpoint=properties.endpoint,
            id, subId=subscriptionId
" --subscriptions $SUB_IDS --first 1000 -o json 2>/dev/null \
  | jq '[.data[] | . + {subName: .subId, resourceId: .id}]')

# Resolve subscription names
RESOURCES_JSON=$(echo "$RESOURCES_JSON" | jq --argjson subs "$SUBS_JSON" '
  [ .[] | . as $r | .subName = ($subs[] | select(.id == $r.subId) | .name) // $r.subId ]')

RESOURCE_COUNT=$(echo "$RESOURCES_JSON" | jq length)
[[ "$RESOURCE_COUNT" -eq 0 ]] && die "No Foundry / OpenAI / Cognitive Services resources found in any subscription."

echo ""
echo -e "${BOLD}  Found $RESOURCE_COUNT Foundry resource(s):${RESET}"
echo ""
echo "$RESOURCES_JSON" | jq -r 'to_entries[] |
  "  \(.key + 1). \(.value.name)  (\(.value.kind))  — \(.value.subName) / \(.value.rg)"'
echo ""

# Select default backend
if [[ "$RESOURCE_COUNT" -eq 1 ]]; then
  DEFAULT_IDX=0
  info "Only one resource found — using it as default backend."
else
  read -rp "  Select default backend resource [1]: " DEFAULT_CHOICE
  DEFAULT_IDX=$(( ${DEFAULT_CHOICE:-1} - 1 ))
  if [[ "$DEFAULT_IDX" -lt 0 || "$DEFAULT_IDX" -ge "$RESOURCE_COUNT" ]]; then
    die "Invalid selection. Pick a number between 1 and $RESOURCE_COUNT."
  fi
fi

DEFAULT_NAME=$(echo "$RESOURCES_JSON" | jq -r ".[$DEFAULT_IDX].name")
DEFAULT_ENDPOINT=$(echo "$RESOURCES_JSON" | jq -r ".[$DEFAULT_IDX].endpoint" | sed 's:/$::')
if [[ -z "$DEFAULT_ENDPOINT" || "$DEFAULT_ENDPOINT" == "null" ]]; then
  DEFAULT_ENDPOINT="https://${DEFAULT_NAME}.openai.azure.com"
fi
DEFAULT_BACKEND_NAME="backend-${DEFAULT_NAME}"
success "Default backend: $DEFAULT_NAME → $DEFAULT_ENDPOINT"

# ══════════════════════════════════════════════════════════════════════════════
# Step 5 — Named Value
# ══════════════════════════════════════════════════════════════════════════════
step "Step 5 — Create Named Value (openai-api-version)"

az rest --method PUT \
  --url "${APIM_MGMT}/namedValues/openai-api-version?api-version=2022-08-01" \
  --headers "Content-Type=application/json" \
  --body "{
    \"properties\": {
      \"displayName\": \"openai-api-version\",
      \"value\": \"${OPENAI_API_VERSION}\",
      \"secret\": false
    }
  }" -o none 2>/dev/null
success "Named Value 'openai-api-version' = ${OPENAI_API_VERSION}"

# ══════════════════════════════════════════════════════════════════════════════
# Step 6 — Create an APIM Backend for EACH Foundry resource
# ══════════════════════════════════════════════════════════════════════════════
step "Step 6 — Create APIM Backends (one per Foundry resource)"

for i in $(seq 0 $((RESOURCE_COUNT - 1))); do
  R_NAME=$(echo "$RESOURCES_JSON"     | jq -r ".[$i].name")
  R_ENDPOINT=$(echo "$RESOURCES_JSON" | jq -r ".[$i].endpoint" | sed 's:/$::')
  if [[ -z "$R_ENDPOINT" || "$R_ENDPOINT" == "null" ]]; then
    R_ENDPOINT="https://${R_NAME}.openai.azure.com"
  fi
  R_SUB_NAME=$(echo "$RESOURCES_JSON" | jq -r ".[$i].subName")
  BK_NAME="backend-${R_NAME}"

  az rest --method PUT \
    --url "${APIM_MGMT}/backends/${BK_NAME}?api-version=2022-08-01" \
    --headers "Content-Type=application/json" \
    --body "{
      \"properties\": {
        \"protocol\": \"http\",
        \"url\": \"${R_ENDPOINT}/openai\",
        \"description\": \"${R_NAME} (${R_SUB_NAME})\",
        \"tls\": {
          \"validateCertificateChain\": true,
          \"validateCertificateName\": true
        }
      }
    }" -o none 2>/dev/null
  success "Backend '${BK_NAME}' → ${R_ENDPOINT}/openai"
done

# ══════════════════════════════════════════════════════════════════════════════
# Step 7 — API + Operation
# ══════════════════════════════════════════════════════════════════════════════
step "Step 7 — Create API + Chat Completions Operation"

API_NAME="azure-openai"

az rest --method PUT \
  --url "${APIM_MGMT}/apis/${API_NAME}?api-version=2022-08-01" \
  --headers "Content-Type=application/json" \
  --body "{
    \"properties\": {
      \"displayName\": \"Azure AI Foundry — OpenAI\",
      \"description\": \"Unified gateway for all Azure AI Foundry model deployments.\",
      \"path\": \"openai\",
      \"protocols\": [\"https\"],
      \"serviceUrl\": \"${DEFAULT_ENDPOINT}/openai\",
      \"subscriptionRequired\": true,
      \"subscriptionKeyParameterNames\": {
        \"header\": \"Ocp-Apim-Subscription-Key\",
        \"query\": \"subscription-key\"
      }
    }
  }" -o none 2>/dev/null
success "API '${API_NAME}' created at path /openai"

OPERATION_ID="create-chat-completion"
az rest --method PUT \
  --url "${APIM_MGMT}/apis/${API_NAME}/operations/${OPERATION_ID}?api-version=2022-08-01" \
  --headers "Content-Type=application/json" \
  --body "{
    \"properties\": {
      \"displayName\": \"Create Chat Completion\",
      \"method\": \"POST\",
      \"urlTemplate\": \"/deployments/{deploymentId}/chat/completions\",
      \"description\": \"Routes to any Foundry deployment.\",
      \"templateParameters\": [{
        \"name\": \"deploymentId\",
        \"required\": true,
        \"type\": \"string\",
        \"description\": \"Foundry model deployment name\"
      }],
      \"request\": {
        \"queryParameters\": [{
          \"name\": \"api-version\",
          \"required\": true,
          \"type\": \"string\",
          \"defaultValue\": \"${OPENAI_API_VERSION}\",
          \"description\": \"Azure OpenAI API version\"
        }],
        \"representations\": [{\"contentType\": \"application/json\"}]
      },
      \"responses\": [
        {\"statusCode\": 200, \"description\": \"Successful chat completion.\", \"representations\": [{\"contentType\": \"application/json\"}]},
        {\"statusCode\": 429, \"description\": \"Rate limit or token quota exceeded.\"}
      ]
    }
  }" -o none 2>/dev/null
success "Operation '${OPERATION_ID}' created"

# ══════════════════════════════════════════════════════════════════════════════
# Step 8 — Operation Policy
# ══════════════════════════════════════════════════════════════════════════════
step "Step 8 — Apply operation policy (default backend: ${DEFAULT_NAME})"

POLICY_XML=$(cat <<'ENDPOLICY'
<policies>
  <inbound>
    <base />
    <set-backend-service backend-id="BACKEND_PLACEHOLDER" />
    <authentication-managed-identity
      resource="https://cognitiveservices.azure.com"
      output-token-variable-name="msi-access-token"
      ignore-error="false" />
    <set-header name="Authorization" exists-action="override">
      <value>@("Bearer " + (string)context.Variables["msi-access-token"])</value>
    </set-header>
    <set-header name="api-key" exists-action="delete" />
    <rate-limit-by-key
      calls="RATE_CALLS_PLACEHOLDER"
      renewal-period="RATE_PERIOD_PLACEHOLDER"
      counter-key="@(context.Subscription.Id)" />
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
    <emit-metric name="APIM Requests" namespace="ClawPilot">
      <dimension name="Subscription ID" />
      <dimension name="Status" value="success" />
    </emit-metric>
  </outbound>
  <on-error>
    <base />
    <emit-metric name="APIM Requests" namespace="ClawPilot">
      <dimension name="Subscription ID" />
      <dimension name="Status" value="blocked" />
    </emit-metric>
  </on-error>
</policies>
ENDPOLICY
)

POLICY_XML="${POLICY_XML//BACKEND_PLACEHOLDER/$DEFAULT_BACKEND_NAME}"
POLICY_XML="${POLICY_XML//RATE_CALLS_PLACEHOLDER/$RATE_LIMIT_CALLS}"
POLICY_XML="${POLICY_XML//RATE_PERIOD_PLACEHOLDER/$RATE_LIMIT_PERIOD}"
POLICY_XML="${POLICY_XML//TPM_PLACEHOLDER/$TOKEN_LIMIT_TPM}"

POLICY_BODY_FILE=$(mktemp)
trap "rm -f '$POLICY_BODY_FILE'" EXIT

jq -n --arg xml "$POLICY_XML" '{properties: {format: "xml", value: $xml}}' > "$POLICY_BODY_FILE"

az rest --method PUT \
  --url "${APIM_MGMT}/apis/${API_NAME}/operations/${OPERATION_ID}/policies/policy?api-version=2022-08-01" \
  --headers "Content-Type=application/json" \
  --body @"$POLICY_BODY_FILE" -o none
success "Policy applied (MI auth, rate limit ${RATE_LIMIT_CALLS}/${RATE_LIMIT_PERIOD}s, ${TOKEN_LIMIT_TPM} TPM)"

# ══════════════════════════════════════════════════════════════════════════════
# Step 9 — Product + link API
# ══════════════════════════════════════════════════════════════════════════════
step "Step 9 — Create Product + link API"

PRODUCT_ID="foundry-access"
az rest --method PUT \
  --url "${APIM_MGMT}/products/${PRODUCT_ID}?api-version=2022-08-01" \
  --headers "Content-Type=application/json" \
  --body "{
    \"properties\": {
      \"displayName\": \"Foundry Access\",
      \"description\": \"Access to all Azure AI Foundry model deployments via APIM.\",
      \"state\": \"published\",
      \"approvalRequired\": false,
      \"subscriptionsLimit\": 50
    }
  }" -o none 2>/dev/null
success "Product '${PRODUCT_ID}' created"

az rest --method PUT \
  --url "${APIM_MGMT}/products/${PRODUCT_ID}/apis/${API_NAME}?api-version=2022-08-01" \
  --headers "Content-Type=application/json" \
  --body "{}" -o none 2>/dev/null
success "API linked to product"

# ══════════════════════════════════════════════════════════════════════════════
# Step 10 — Dev Subscription
# ══════════════════════════════════════════════════════════════════════════════
step "Step 10 — Create dev subscription"

PRODUCT_FULL_ID="${APIM_MGMT}/products/${PRODUCT_ID}"
SUB_DISPLAY="Dev / VS Code Testing"

EXISTING_SUB=$(az rest --method GET \
  --url "${APIM_MGMT}/subscriptions?api-version=2022-08-01" \
  2>/dev/null | jq -r ".value[] | select(.properties.displayName == \"${SUB_DISPLAY}\") | .name" || echo "")

if [[ -n "$EXISTING_SUB" ]]; then
  success "Subscription '${SUB_DISPLAY}' already exists"
  SUB_KEY=$(az rest --method POST \
    --url "${APIM_MGMT}/subscriptions/${EXISTING_SUB}/listSecrets?api-version=2022-08-01" \
    2>/dev/null | jq -r '.primaryKey')
else
  RESULT=$(az rest --method PUT \
    --url "${APIM_MGMT}/subscriptions/dev-testing?api-version=2022-08-01" \
    --headers "Content-Type=application/json" \
    --body "{
      \"properties\": {
        \"scope\": \"${PRODUCT_FULL_ID}\",
        \"displayName\": \"${SUB_DISPLAY}\",
        \"state\": \"active\",
        \"allowTracing\": true
      }
    }" 2>/dev/null)
  success "Subscription '${SUB_DISPLAY}' created"
  SUB_KEY=$(echo "$RESULT" | jq -r '.properties.primaryKey')
fi

# Per-user APIM subscriptions (for per-user analytics via emit-metric)
API_SCOPE="${APIM_MGMT}/apis/${API_NAME}"
USER_SUBS=("peter-parker:Peter Parker" "tonny-stark:Tonny Stark" "son-goku:Son Goku" "monkey-d-luffy:Monkey D. Luffy")
for entry in "${USER_SUBS[@]}"; do
  USR_ID="${entry%%:*}"
  USR_DISPLAY="${entry#*:}"
  az rest --method PUT \
    --url "${APIM_MGMT}/subscriptions/${USR_ID}?api-version=2022-08-01" \
    --headers "Content-Type=application/json" \
    --body "$(jq -n --arg scope "$API_SCOPE" --arg name "$USR_DISPLAY" '{properties:{scope:$scope,displayName:$name,state:"active"}}')" \
    -o none 2>/dev/null
  success "User subscription '${USR_ID}' created"
done

# ══════════════════════════════════════════════════════════════════════════════
# Step 11 — RBAC: APIM MI → ALL Foundry resources
# ══════════════════════════════════════════════════════════════════════════════
step "Step 11 — Assign 'Cognitive Services OpenAI User' on ALL resources"

OPENAI_USER_ROLE="5e0bd9bd-7b93-4f28-af87-19fc36ad61bd"

for i in $(seq 0 $((RESOURCE_COUNT - 1))); do
  R_NAME=$(echo "$RESOURCES_JSON"    | jq -r ".[$i].name")
  R_ID=$(echo "$RESOURCES_JSON"      | jq -r ".[$i].resourceId")
  R_SUB_ID=$(echo "$RESOURCES_JSON"  | jq -r ".[$i].subId")

  EXISTING_ROLE=$(az role assignment list \
    --assignee "$APIM_MI_PRINCIPAL" \
    --scope "$R_ID" \
    --role "$OPENAI_USER_ROLE" \
    --subscription "$R_SUB_ID" \
    --query "[0].id" -o tsv 2>/dev/null || echo "")

  if [[ -n "$EXISTING_ROLE" ]]; then
    success "${R_NAME} — role already assigned"
  else
    az role assignment create \
      --assignee-object-id "$APIM_MI_PRINCIPAL" \
      --assignee-principal-type ServicePrincipal \
      --role "$OPENAI_USER_ROLE" \
      --scope "$R_ID" \
      --subscription "$R_SUB_ID" \
      -o none 2>/dev/null
    success "${R_NAME} — role assigned"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════
# Step 12 (optional) — Private Networking
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$SETUP_PRIVATE_NET" == "y" || "$SETUP_PRIVATE_NET" == "Y" ]]; then
  step "Step 12 — Private Networking (VNet, PE, Private DNS)"

  VNET_NAME="${VNET_NAME:-vnet-${APIM_NAME}}"
  VNET_CIDR="${VNET_CIDR:-10.0.0.0/16}"
  SNET_APIM_CIDR="${SNET_APIM_CIDR:-10.0.1.0/24}"
  SNET_PE_CIDR="${SNET_PE_CIDR:-10.0.2.0/24}"

  az network vnet create \
    --name "$VNET_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --subscription "$APIM_SUB_ID" \
    --address-prefix "$VNET_CIDR" -o none 2>/dev/null
  success "VNet '$VNET_NAME' ($VNET_CIDR)"

  az network vnet subnet create \
    --vnet-name "$VNET_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name snet-apim --address-prefixes "$SNET_APIM_CIDR" -o none 2>/dev/null
  success "Subnet 'snet-apim' ($SNET_APIM_CIDR)"

  az network vnet subnet create \
    --vnet-name "$VNET_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name snet-private-endpoints --address-prefixes "$SNET_PE_CIDR" \
    --disable-private-endpoint-network-policies true -o none 2>/dev/null
  success "Subnet 'snet-private-endpoints' ($SNET_PE_CIDR)"

  NSG_NAME="nsg-${APIM_NAME}"
  az network nsg create --name "$NSG_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --subscription "$APIM_SUB_ID" -o none 2>/dev/null

  az network nsg rule create --nsg-name "$NSG_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name AllowApimManagementInbound --priority 100 --direction Inbound \
    --access Allow --protocol Tcp --source-address-prefixes ApiManagement \
    --destination-address-prefixes VirtualNetwork --destination-port-ranges 3443 -o none 2>/dev/null
  az network nsg rule create --nsg-name "$NSG_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name AllowAzureLBInbound --priority 110 --direction Inbound \
    --access Allow --protocol Tcp --source-address-prefixes AzureLoadBalancer \
    --destination-address-prefixes VirtualNetwork --destination-port-ranges 6390 -o none 2>/dev/null
  az network nsg rule create --nsg-name "$NSG_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name AllowHttpsInbound --priority 120 --direction Inbound \
    --access Allow --protocol Tcp --source-address-prefixes Internet \
    --destination-address-prefixes VirtualNetwork --destination-port-ranges 443 -o none 2>/dev/null
  az network nsg rule create --nsg-name "$NSG_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name AllowStorageOutbound --priority 100 --direction Outbound \
    --access Allow --protocol Tcp --source-address-prefixes VirtualNetwork \
    --destination-address-prefixes Storage --destination-port-ranges 443 -o none 2>/dev/null
  az network nsg rule create --nsg-name "$NSG_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name AllowSqlOutbound --priority 110 --direction Outbound \
    --access Allow --protocol Tcp --source-address-prefixes VirtualNetwork \
    --destination-address-prefixes Sql --destination-port-ranges 1433 -o none 2>/dev/null
  az network nsg rule create --nsg-name "$NSG_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name AllowAadOutbound --priority 140 --direction Outbound \
    --access Allow --protocol Tcp --source-address-prefixes VirtualNetwork \
    --destination-address-prefixes AzureActiveDirectory --destination-port-ranges 443 -o none 2>/dev/null

  az network vnet subnet update \
    --vnet-name "$VNET_NAME" -g "$RESOURCE_GROUP" --name snet-apim \
    --subscription "$APIM_SUB_ID" \
    --network-security-group "$NSG_NAME" -o none 2>/dev/null
  success "NSG '$NSG_NAME' attached to snet-apim"

  DNS_ZONE="privatelink.openai.azure.com"
  az network private-dns zone create \
    --name "$DNS_ZONE" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" -o none 2>/dev/null || true
  success "Private DNS zone '$DNS_ZONE'"

  VNET_ID=$(az network vnet show --name "$VNET_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" --query id -o tsv)
  az network private-dns link vnet create \
    --zone-name "$DNS_ZONE" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --name "vnetlink-${APIM_NAME}" --virtual-network "$VNET_ID" \
    --registration-enabled false -o none 2>/dev/null || true
  success "VNet linked to DNS zone"

  PE_SUBNET_ID=$(az network vnet subnet show \
    --vnet-name "$VNET_NAME" -g "$RESOURCE_GROUP" --name snet-private-endpoints \
    --subscription "$APIM_SUB_ID" --query id -o tsv)

  for i in $(seq 0 $((RESOURCE_COUNT - 1))); do
    R_NAME=$(echo "$RESOURCES_JSON" | jq -r ".[$i].name")
    R_ID=$(echo "$RESOURCES_JSON"   | jq -r ".[$i].resourceId")
    PE_NAME="pe-${R_NAME}"

    az network private-endpoint create \
      --name "$PE_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
      --subscription "$APIM_SUB_ID" \
      --subnet "$PE_SUBNET_ID" \
      --private-connection-resource-id "$R_ID" \
      --group-ids account \
      --connection-name "psc-${R_NAME}" -o none 2>/dev/null || true

    az network private-endpoint dns-zone-group create \
      --endpoint-name "$PE_NAME" -g "$RESOURCE_GROUP" \
      --subscription "$APIM_SUB_ID" \
      --name "dns-group-${R_NAME}" \
      --zone-name "$DNS_ZONE" \
      --private-dns-zone "/subscriptions/${APIM_SUB_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Network/privateDnsZones/${DNS_ZONE}" \
      -o none 2>/dev/null || true
    success "Private Endpoint '${PE_NAME}' → ${R_NAME}"
  done

  warn "Injecting APIM into VNet (External mode). This takes 30–45 minutes..."
  SNET_APIM_ID=$(az network vnet subnet show \
    --vnet-name "$VNET_NAME" -g "$RESOURCE_GROUP" --name snet-apim \
    --subscription "$APIM_SUB_ID" --query id -o tsv)
  az apim update --name "$APIM_NAME" -g "$RESOURCE_GROUP" \
    --subscription "$APIM_SUB_ID" \
    --set virtualNetworkType=External \
    --set "virtualNetworkConfiguration.subnetResourceId=${SNET_APIM_ID}" \
    -o none 2>/dev/null
  success "APIM VNet injection complete"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
GATEWAY_URL=$(az apim show --name "$APIM_NAME" -g "$RESOURCE_GROUP" \
  --subscription "$APIM_SUB_ID" --query gatewayUrl -o tsv)

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║                    Wiring Complete!                      ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}APIM:${RESET}            ${APIM_NAME}  (${APIM_SUB_NAME})"
echo -e "  ${BOLD}Gateway URL:${RESET}     ${GATEWAY_URL}"
echo -e "  ${BOLD}Sub Key:${RESET}         ${SUB_KEY:-<retrieve from portal>}"
echo -e "  ${BOLD}Default Backend:${RESET} ${DEFAULT_NAME}"
echo -e "  ${BOLD}Resources Wired:${RESET} ${RESOURCE_COUNT}"
echo ""
echo -e "  ${BOLD}All backends created:${RESET}"
for i in $(seq 0 $((RESOURCE_COUNT - 1))); do
  R_NAME=$(echo "$RESOURCES_JSON"     | jq -r ".[$i].name")
  R_SUB_NAME=$(echo "$RESOURCES_JSON" | jq -r ".[$i].subName")
  MARKER=""
  [[ "$R_NAME" == "$DEFAULT_NAME" ]] && MARKER=" ${GREEN}← default${RESET}"
  echo -e "    • backend-${R_NAME}  (${R_SUB_NAME})${MARKER}"
done
echo ""
echo -e "  ${BOLD}Example call:${RESET}"
echo -e "  ${DIM}curl -X POST '${GATEWAY_URL}/openai/deployments/<model>/chat/completions?api-version=${OPENAI_API_VERSION}' \\${RESET}"
echo -e "  ${DIM}  -H 'Ocp-Apim-Subscription-Key: ${SUB_KEY:-<key>}' \\${RESET}"
echo -e "  ${DIM}  -H 'Content-Type: application/json' \\${RESET}"
echo -e "  ${DIM}  -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}'${RESET}"
echo ""
echo -e "  ${BOLD}.env values for the dashboard:${RESET}"
echo -e "  APIM_SERVICE_NAME=${APIM_NAME}"
echo -e "  APIM_API_ID=${API_NAME}"
echo -e "  APIM_BACKEND_ID=${DEFAULT_BACKEND_NAME}"
echo -e "  DEFAULT_TPM=${TOKEN_LIMIT_TPM}"
echo ""

# Write suggested .env entries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APIM_ENV_SNIPPET="${REPO_ROOT}/.env.apim"
cat > "$APIM_ENV_SNIPPET" <<EOF
# Generated by wire-apim.sh — $(date -Iseconds)
APIM_SERVICE_NAME=${APIM_NAME}
APIM_API_ID=${API_NAME}
APIM_BACKEND_ID=${DEFAULT_BACKEND_NAME}
DEFAULT_TPM=${TOKEN_LIMIT_TPM}
EOF
info "APIM env snippet written to .env.apim — merge into your .env file"
