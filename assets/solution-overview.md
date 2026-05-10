# Foundry Observability — Solution Overview

## What Is It?

**Foundry Observability** is a self-hosted governance and observability platform for Azure AI Foundry / Azure OpenAI deployments. It gives engineering teams and platform owners real-time visibility into AI model consumption, per-user and per-group quota enforcement, cost tracking, and policy management — all from a single React dashboard backed by a secure APIM gateway and a FastAPI backend.

---

## Challenges It Solves

| # | Challenge | How It Is Addressed |
|---|-----------|---------------------|
| 1 | **Visibility gap** — Azure AI Foundry provides no per-user or per-team token consumption view | Dashboard queries Azure Monitor metrics per deployment + APIM subscription reports per user |
| 2 | **Cost control before quota exhaustion** — No native per-subscription budget enforcement | Configurable cost limits and monthly token caps stored server-side; TPM quotas enforced at the APIM gateway layer |
| 3 | **Multi-model governance** — Multiple models, multiple consumers, no single control point | APIM acts as the unified gateway; individual subscription keys per user, rate limits and policies per API |
| 4 | **Key-free secure access** — Distributing API keys to consumers is a security anti-pattern | Each consumer has an APIM subscription key; no Foundry credentials ever leave the backend |
| 5 | **Network-level isolation** — Public AI endpoints can be attacked directly, bypassing the gateway | Foundry is only reachable via a VNet Private Endpoint; APIM backend traffic never traverses the public internet |
| 6 | **Policy sprawl** — APIM rate-limit XML is hard to manage manually | Dashboard exposes a live policy editor that PUTs policy changes directly to APIM via the ARM API |

---

## Architecture Overview

```
┌─────────────────── Client Tier ────────────────────────────────┐
│  [Entra ID]  [Admin/Dev]  [React SPA]  [AI Client Scripts]    │
└────────────────────────────────────────────────────────────────┘
                         │
┌─────────────── Application Tier ───────────────────────────────┐
│  [Docker Container]  [FastAPI Backend]  [Azure ARM API]        │
└────────────────────────────────────────────────────────────────┘
         │                                        │ (metrics query)
┌── Azure VNet (10.0.0.0/16) ──────┐  ┌─ Observability ────────┐
│  snet-apim (10.0.1.0/24)         │  │  [Azure Monitor]        │
│    [APIM]  [NSG]                 │  │  [Application Insights] │
│  snet-private-endpoints           │  │  [Log Analytics]        │
│    [Private Endpoint]  [DNS Zone] │  └────────────────────────┘
└──────────────────────────────────┘
                │ (private link)
┌─────── Azure AI Services ──────────────────────────────────────┐
│  [Azure AI Foundry]  gpt-4.1-mini · Kimi-K2.6                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Components & Services

### Frontend — React SPA (TypeScript)

- **Framework:** Vite + React 18 + TypeScript
- **UI:** TailwindCSS, Lucide icons
- **Charts:** Recharts (area, bar, composed, pie)
- **Auth:** MSAL.js v3 — OAuth2 Authorization Code + PKCE flow
- **Key features:**
  - Token consumption dashboard with hourly / daily / weekly / monthly granularity
  - Per-deployment model usage table (input tokens, output tokens, total tokens, estimated cost)
  - Per-user and per-group usage breakdown via APIM subscription reports
  - Cost & budget settings per user, per group, and per project
  - Live APIM policy XML editor with VS Code-style line numbers (TPM / call quota tuning without redeployment)
  - Epoch-based counter-key rotation — each Apply creates fresh rate-limit buckets, preventing stale 429s
  - Usage Forecast page — monthly cost projection (7/14/30-day lookback), top subs/resources/projects
  - Provisioned Quotas page — cross-subscription TPM/RPM view with charts and sortable tables
  - Custom date range picker + quick-select presets (1D / 7D / 14D / 1M)

### Backend — FastAPI (Python)

The backend is an ASGI application served by **uvicorn** inside a Docker container. It serves the React SPA static files and exposes the following API endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/config` | Returns runtime config (clientId, tenantId, APIM names) |
| `GET /api/subscriptions` | Lists Azure subscriptions visible to the signed-in user |
| `GET /api/foundry-resources` | Lists CognitiveServices accounts in a subscription |
| `GET /api/projects` | Lists AI Foundry projects under a resource |
| `GET /api/deployments` | Lists model deployments with model name and format |
| `GET /api/metrics` | Queries Azure Monitor for token metrics per deployment |
| `GET /api/forecast` | Aggregates metrics across all resources for cost forecasting |
| `GET /api/quotas` | Returns provisioned TPM/RPM for every deployment across all subscriptions |
| `GET /api/users-groups` | Queries Log Analytics (KQL) for per-user and per-group request stats |
| `GET /api/cost-limits` | Reads budget config (cost_limits.json) |
| `PUT /api/cost-limits` | Writes budget config for users, groups, projects |
| `GET /api/policy` | Gets current APIM API policy XML via ARM API |
| `PUT /api/policy` | Updates APIM API policy XML via ARM API |
| `DELETE /api/policy` | Resets APIM policy to minimal pass-through |
| `GET /api/pricing` | Returns scraped Azure model pricing (OpenAI, DeepSeek, Kimi, Llama, Phi) |

> All ARM API calls are made with the user's Bearer token forwarded from the browser — Azure RBAC is automatically enforced; the backend never escalates privileges.

### Azure API Management (APIM)

- **SKU:** StandardV2 (recommended) or Developer (dev/test)
- **VNet mode:** External — gateway is internet-accessible; all backend calls to Foundry travel within the VNet
- **Exposed API:** `POST /openai/deployments/{deploymentId}/chat/completions`
- **Controls:**
  - Rate limit per subscription (calls/minute, configurable per APIM subscription)
  - Token-per-minute (TPM) quota per subscription
  - Per-user APIM subscription keys (individual governance)
  - Named Values for centralised config (`openai-api-version`, TPM defaults)
- **Observability:**
  - APIM Logger connected to Application Insights
  - 100% sampling diagnostic captures all headers and first 512 bytes of request/response bodies
  - Token quota headers (`x-ratelimit-remaining-tokens`) logged
  - W3C HTTP correlation protocol for end-to-end distributed tracing

### Azure AI Foundry / Azure OpenAI

- **Provider:** `Microsoft.CognitiveServices` (kind: AIServices / OpenAI)
- **Deployed models:** `gpt-5.4-mini`, `Kimi-K2.5`, `DeepSeek-V3.2`, `Llama-4-Maverick`, `gpt-5.3-codex` (configurable via env vars)
- **Access:** Only reachable via private endpoint — no public internet path from APIM to Foundry

### Azure Application Insights

- Workspace-based (linked to the Log Analytics Workspace)
- Ingests all APIM diagnostic events at 100% sampling
- Captures request/response headers, token quota headers, client IP, first 512 bytes of bodies, HTTP correlation IDs
- Errors always logged regardless of sampling rate

### Log Analytics Workspace

- Name: `law-foundry-observability`
- SKU: PerGB2018, 30-day retention
- Backend store for Application Insights telemetry

### Azure Monitor

- Queried by the FastAPI backend via the REST metrics API
- Namespace: `microsoft.cognitiveservices/accounts`
- Metrics: `InputTokens`, `OutputTokens`, `TotalTokens`, `ModelRequests`
- Filtered per `ModelDeploymentName` dimension, aggregated as `Total`

### Networking

| Resource | Value |
|----------|-------|
| VNet | `vnet-foundry-observability` — `10.0.0.0/16` |
| snet-apim | `10.0.1.0/24` — APIM External VNet injection |
| snet-private-endpoints | `10.0.2.0/24` — Private endpoint NIC |
| NSG (APIM subnet) | Allow: 443, 80, 3443 (APIM mgmt), 6390 (Azure LB probe) |
| Private Endpoint | NIC in snet-pe pointing to the Foundry resource |
| Private DNS Zone | `privatelink.openai.azure.com` — resolves Foundry FQDN to private IP |

### AI Client Scripts (`usage-simulation/`)

Simulated consumers used for load testing and demo purposes:
- `peter_parker.py`, `tonny_stark.py` — "superheroes" group
- `son_goku.py`, `monkey_d_luffy.py` — "manga" group
- `simulate_to_budget.py` — sends calls until a cost threshold is reached
- `simulate_user.py` — single-user simulation with markdown output and cost tracking
- `run_all.py` — parallel simulation runner
- `single-simulation/simulate_user.py` — one-off single-user sim with per-deployment pricing
- `single-simulation/burst_simulate.py` — rapid-fire burst to trigger APIM 429 throttling

---

## Security Design

### Authentication

The React SPA uses **MSAL.js** with the **OAuth2 Authorization Code + PKCE** flow. No client secret is ever distributed to the browser. Upon login, Microsoft Entra ID issues a short-lived JWT access token scoped to Azure Resource Manager (`https://management.azure.com/user_impersonation`). The token is stored in **browser SessionStorage** only — never in localStorage, never in a cookie.

The Entra ID app registration is configured as a **single-tenant SPA** with no implicit flow and no client credentials grant.

### Authorization — Role-Based Access Control (RBAC)

The FastAPI backend acts as a **transparent ARM proxy**. Every call to the Azure Resource Manager API is made with the user's own Bearer token forwarded from the browser. This means:

- A user who lacks `Reader` on a subscription cannot list its resources.
- A user who lacks `API Management Contributor` cannot update APIM policies.
- The backend **never** stores or escalates credentials.

**APIM Managed Identity** is assigned the minimum required role on the Foundry resource, enabling APIM to authenticate its backend requests to Foundry via Azure AD token exchange — no stored API keys in the gateway.

### Network Isolation

Azure AI Foundry is not reachable from the public internet via APIM. APIM is VNet-injected (External mode), and all backend calls route through the **private endpoint** in `snet-private-endpoints`. The **Private DNS Zone** resolves the Foundry FQDN (`*.openai.azure.com`) to a `10.x` address, ensuring TLS certificate validation succeeds against the original hostname while traffic remains entirely private.

### Gateway-Level Controls

Every AI consumer is issued an **individual APIM subscription key**. APIM enforces:
- **Rate limits** — calls per minute per subscription (HTTP 429 when exceeded)
- **TPM quotas** — token-per-minute caps per subscription
- **Policy XML** — centrally managed, updatable without consumer changes

This prevents a single runaway consumer from exhausting shared Foundry capacity.

### Secret Management

- No credentials are hard-coded anywhere.
- Runtime config (tenantId, clientId, APIM service names) is injected via **environment variables** at container start.
- `cost_limits.json` is the only server-side state file — it contains no credentials.
- APIM subscription keys are managed entirely within APIM and scoped per user.

### NSG Hardening

The APIM subnet NSG allows **only** the minimum required inbound rules:

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 443 | TCP | Internet | Client HTTPS to APIM gateway |
| 80 | TCP | Internet | HTTP → HTTPS redirect |
| 3443 | TCP | ApiManagement | Azure APIM management plane |
| 6390 | TCP | AzureLoadBalancer | Azure LB health probes |

All other inbound traffic is denied by the default deny-all rule.

---

## Data Flow

```
1. User opens browser → React SPA loads (served by FastAPI)
2. MSAL.js popup/redirect → Entra ID issues JWT (ARM scope)
3. SPA calls /api/config to fetch APIM name, clientId, tenantId
4. Dashboard queries (user ARM token forwarded on every call):
     a. /api/metrics       → FastAPI → Azure Monitor REST API
     b. /api/users-groups  → FastAPI → APIM ARM reports API
     c. /api/deployments   → FastAPI → ARM CognitiveServices API
5. AI Client → HTTPS POST to APIM gateway with APIM subscription key
6. APIM enforces rate limit & TPM quota
     → routes request via VNet → Private Endpoint
     → Azure AI Foundry processes inference
     → response returned to AI client
7. APIM Logger → Application Insights → Log Analytics (telemetry)
8. Admin updates APIM policy via Settings page
     → /api/policy PUT → FastAPI → ARM APIM Policy API
9. Admin sets budgets via Settings
     → /api/cost-limits PUT → cost_limits.json
```

---

## Repository Structure

```
/
├── backend/            FastAPI app + routers
│   ├── main.py
│   ├── routers/        config, subscriptions, metrics, deployments,
│   │                   policy, cost_limits, quotas, pricing
│   ├── cost_limits.json
│   └── static/         Built React SPA (served by FastAPI)
├── frontend/           React SPA source (Vite + TypeScript)
│   └── src/
│       ├── api/        ARM REST client (useApiClient hook)
│       ├── auth/       MSAL configuration
│       ├── components/ Dashboard, Settings, UsageForecast, Quotas, About, Layout, LoginPage
│       ├── pricing.ts  Model pricing table (Azure Global Standard)
│       └── context/    AppContext (subscription/resource selection)
├── usage-simulation/   Simulated AI consumer scripts
│   ├── single-simulation/  One-off simulate_user.py + burst_simulate.py
│   └── ...             per-user scripts, run_all, simulate_to_budget
├── clients/            Direct Foundry call examples
├── docs/               Entra app registration guide, usage simulation guide
├── scripts/            register-entra-app.sh, wire-apim.sh
├── assets/             Architecture diagrams + solution overview
├── Dockerfile          Multi-stage container build
└── docker-compose.yml  Single-service compose for local/production run
```

---

*Last updated: May 2026*
