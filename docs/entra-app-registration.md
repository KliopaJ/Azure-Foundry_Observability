# Entra ID App Registration Automation

`scripts/register-entra-app.sh` is a fully interactive Bash script that provisions everything Microsoft Entra ID needs before you can run the foundry-observability app.  Run it once per tenant — it is safe to re-run against an existing registration.

---

## Prerequisites

| Tool | Install |
|---|---|
| [Azure CLI](https://aka.ms/install-azure-cli) | `brew install azure-cli` / `winget install Microsoft.AzureCLI` |
| [jq](https://stedolan.github.io/jq/) | `brew install jq` / `apt install jq` |

The account used to run the script must have **Application Administrator** (or higher) role in Entra ID so it can create and modify app registrations.

---

## How to run

```bash
# from the repo root
./scripts/register-entra-app.sh
```

The script walks you through a series of prompts. Every prompt has a sensible default — press **Enter** to accept.

---

## Step-by-step walkthrough

### Step 1 — Choose an authentication method

```
Authentication method
  1) az login  (interactive browser sign-in)
  2) Service Principal  (client ID + secret, for CI/CD)

Enter choice [1/2]:
```

**Option 1 — `az login` (recommended for developer machines)**

Opens a browser pop-up for interactive Microsoft sign-in.  After sign-in the script reads `tenantId` from `az account show` automatically.  No credentials are stored anywhere.

**Option 2 — Service Principal (recommended for CI/CD pipelines)**

Prompts for three values:

| Prompt | What to enter |
|---|---|
| SP Client ID | `appId` of a pre-existing Service Principal |
| SP Client Secret | The secret/password for that SP |
| Tenant ID | Your Azure AD / Entra tenant GUID |

The script then calls `az login --service-principal` which is non-interactive — safe to use in GitHub Actions, Azure Pipelines, or any automated environment.

---

### Step 2 — Redirect URIs

```
http://localhost:8004  will always be added (local dev).
Container Apps hostname (leave blank to skip, e.g. myapp.azurecontainerapps.io):
```

`http://localhost:8004` is always registered (the FastAPI backend listens on port 8004 in local dev mode).

If you paste a Container Apps hostname (with or without the `https://` prefix), the script sanitises it and adds `https://<hostname>` as a second redirect URI.  You can add more redirect URIs later via the Azure Portal → App registrations → Authentication.

---

### Step 3 — Idempotency check

The script searches Entra ID for an existing app named `foundry-observability`.

- **If found** — it asks whether to reuse it (default: yes).  Reusing avoids creating duplicate registrations.
- **If you decline** — a new app is created with a timestamp suffix (e.g. `foundry-observability-20260430120000`).
- **If not found** — a new app is created immediately.

---

### Step 4 — App registration creation

Creates the Entra ID application with:

| Setting | Value |
|---|---|
| Display name | `foundry-observability` |
| Supported account types | `AzureADMyOrg` (single tenant — your org only) |

The `appId` (client ID) and internal `objectId` are captured for the subsequent steps.

---

### Step 5 — SPA redirect URIs

Sets the redirect URIs on the **Single-page application** platform (not the legacy Web platform).  This is required for the MSAL.js popup / redirect flow used by the React frontend.

The Microsoft Graph PATCH call used:
```
PATCH https://graph.microsoft.com/v1.0/applications/{objectId}
{ "spa": { "redirectUris": ["http://localhost:8004", ...] } }
```

---

### Step 6 — ID-token implicit grant

Enables `enableIdTokenIssuance: true` on the app so that MSAL can receive an ID token in the browser after sign-in.  Access token issuance via implicit grant is deliberately left **disabled** (MSAL uses the auth-code-with-PKCE flow for access tokens, which is more secure).

---

### Step 7 — Azure Management API permission

Registers the delegated `user_impersonation` scope on the Azure Service Management API (`797f4846-ba00-4fd7-ba43-dac1f8f63013`).

This is the scope that lets the signed-in user's identity call Azure Resource Manager (ARM) endpoints — listing subscriptions, reading Foundry metrics, managing APIM policies — with their own Azure RBAC permissions enforced automatically.

> **Admin consent**  
> If your tenant requires admin consent for delegated permissions, a Global Administrator must run:
> ```bash
> az ad app permission admin-consent --id <CLIENT_ID>
> ```
> The script prints this command at the end if it was needed.

The script is idempotent on this step — if the permission already exists it skips silently.

---

### Step 8 — Service Principal

Checks whether an enterprise application (service principal) already exists for the app registration. Creates one if not.  This is required for the app to appear in **Enterprise Applications** and for admin-consent flows to work.

---

### Step 9 — Write to `.env`

```
Update existing .env? [Y/n]:
```

- If `.env` already exists, the script **updates** `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` in-place (all other values are preserved).
- If `.env` does not exist, it **copies** `.env.example` to `.env` and then fills in the two values.

The `.env` file is never committed to source control (it is listed in `.gitignore`).

---

## After the script

The script ends with a summary and a checklist:

```
App Display Name : foundry-observability
AZURE_CLIENT_ID  : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_TENANT_ID  : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Redirect URIs configured:
  • http://localhost:8004

API Permission : Azure Service Management — user_impersonation (delegated)
```

### Remaining manual steps

1. **(If required)** Grant admin consent:
   ```bash
   az ad app permission admin-consent --id <CLIENT_ID>
   ```

2. Fill in the APIM variables in `.env`:
   ```
   APIM_SERVICE_NAME=<your-apim-resource-name>
   APIM_SUBSCRIPTION_ID=<your-subscription-id>
   APIM_RESOURCE_GROUP=<your-apim-resource-group>
   APIM_API_ID=<api-id-in-apim>
   APIM_BACKEND_ID=<backend-id-in-apim>
   DEFAULT_TPM=100000
   ```

3. Run the app locally:
   ```bash
   cd backend
   .venv/bin/uvicorn main:app --port 8004
   # open http://localhost:8004
   ```

4. Or build and run via Docker:
   ```bash
   docker-compose up --build
   ```

---

## What the script does NOT do

- It does not create Azure resources (APIM, Container Apps, etc.).  Those must be provisioned separately in your Azure subscription.
- It does not assign any Azure RBAC roles.  Users need at least **Reader** on the Azure subscription to view Foundry metrics, and **Contributor** on the APIM resource to apply policies.
- It does not create a client secret.  The app uses the delegated (user-impersonation) flow — no secret is needed for the browser client.

---

## Re-running the script

Running the script again is safe.  It will:
- Detect the existing app registration and offer to reuse it.
- Skip permissions that are already configured.
- Overwrite only `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` in `.env`.
