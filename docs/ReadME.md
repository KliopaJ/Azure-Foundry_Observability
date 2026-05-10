# Foundry Observability

A comprehensive multi-user platform for monitoring Azure AI Foundry usage, forecasting costs, managing APIM token rate limits, and tracking provisioned quotas — across all subscriptions and resources in one place.

## Features

### Dashboard
- Real-time token usage metrics: InputTokens, OutputTokens, TotalTokens, ModelRequests
- Token trend charts with moving average, input vs. output breakdown, requests by deployment
- Estimated cost per deployment using Azure OpenAI pricing (Global Standard tier)
- Deployment summary table with model, tokens, requests, and cost
- Users & Groups section: per-user and per-group KPI cards, request charts, cost estimation, model usage breakdown
- Granularity: Hourly (PT1H), Daily (P1D), Weekly (P1W), Monthly (P1M)
- Date ranges: 1D, 7D, 14D, 30D
- "All subscriptions" and "All resources" mode via Azure Resource Graph

### Settings
- Manage APIM rate limits across three layers: per-user → per-group → per-deployment
- Two limit modes: TPM (tokens-per-minute) or monthly dollar budget (auto-converted to TPM)
- View and edit the live APIM policy XML (VS Code-style line numbers)
- Apply or reset policies with managed-identity auth, emit-metric, and deployment dimensions
- Epoch-based counter-key rotation — each Apply creates fresh rate-limit buckets, preventing stale 429s
- Cost limits configuration for users, groups, and deployments

### Usage Forecast
- Monthly cost projection based on observed usage (7 / 14 / 30-day lookback windows)
- Cross-subscription aggregation: queries all Foundry resources in parallel
- Top subscriptions, top resources, and top projects by estimated cost
- Cost distribution pie chart by subscription
- Per-user and per-group forecast charts
- Detailed breakdown tables for subscriptions, resources, users, and groups

### Provisioned Quotas
- Cross-subscription view of all provisioned TPM and RPM quotas
- Aggregate by resource, model, region, or subscription
- TPM distribution pie chart by model, TPM by region bar chart
- Full deployment table with sortable columns and grouping (by model, region, resource, subscription, SKU)
- Search filter across deployments, models, regions, and subscriptions
- Direct links to Azure Portal quota request form per deployment

### Authentication & Authorization
- MSAL.js Entra ID sign-in (per-user Azure accounts)
- ARM tokens acquired per-request for management API calls
- Azure RBAC enforces permissions; no shared credentials in frontend
- Configurable client ID and tenant ID via backend config

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend                          │
│  React + TypeScript + Vite                          │
│  TanStack Query · Recharts · Tailwind CSS · MSAL.js │
└────────────────────┬────────────────────────────────┘
                     │ /api/*
┌────────────────────▼────────────────────────────────┐
│                    Backend                           │
│  FastAPI + uvicorn (serves SPA + API on same port)  │
└────┬──────┬──────┬──────┬──────┬──────┬─────────────┘
     │      │      │      │      │      │
     ▼      ▼      ▼      ▼      ▼      ▼
  Azure   Azure   Azure   APIM   Log    Resource
  Monitor Foundry Subscriptions  Analytics Graph
  (metrics)(deployments)  (policy) (KQL)  (cross-sub)
```

### Backend Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | APIM configuration (name, subscription, resource group, API/backend IDs, default TPM) |
| `/api/subscriptions` | GET | All enabled Azure subscriptions |
| `/api/foundry-resources` | GET | AI Foundry / OpenAI / Cognitive Services accounts (`__all__` for cross-sub) |
| `/api/projects` | GET | Projects under a Foundry resource |
| `/api/deployments` | GET | Model deployments for a Foundry resource |
| `/api/metrics` | GET | Azure Monitor token usage metrics per deployment |
| `/api/forecast` | GET | Cross-subscription metrics aggregation for cost forecasting |
| `/api/quotas` | GET | Provisioned TPM/RPM quotas for every deployment across all subscriptions |
| `/api/policy` | GET/PUT/DELETE | APIM policy management (parse, build, reset) |
| `/api/users-groups` | GET | Log Analytics KQL query for per-user/group request stats |
| `/api/cost-limits` | GET/PUT | Cost limit configuration |
| `/api/pricing` | GET | Azure model pricing (OpenAI, DeepSeek, Kimi, Llama, Phi) |

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 18, TypeScript, Vite, TanStack Query, Recharts, Tailwind CSS, MSAL.js |
| Backend | Python 3.13, FastAPI, uvicorn, httpx |
| Azure | AI Foundry, API Management, Azure Monitor, Log Analytics, Entra ID, Resource Graph |
| Deployment | Docker (single container), Azure Container Apps / App Service compatible |

## Setup

### Prerequisites
- Node.js 18+
- Python 3.11+
- Azure subscription with AI Foundry resource
- Azure API Management instance
- Entra ID app registration

### Environment Variables

Create a `.env` file in the project root:

```env
APIM_SERVICE_NAME=your-apim-name
APIM_SUBSCRIPTION_ID=your-subscription-id
APIM_RESOURCE_GROUP=your-apim-resource-group
APIM_API_ID=azure-openai
APIM_BACKEND_ID=backend-your-foundry-resource
DEFAULT_TPM=60000
CLIENT_ID=your-entra-app-client-id
TENANT_ID=your-entra-tenant-id
LAW_NAME=your-log-analytics-workspace-name
```

### Development

```bash
# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8004

# Frontend (dev server)
cd frontend
npm install
npm run dev
```

### Production Build

```bash
cd frontend && npm run build
rm -rf ../backend/static && cp -r dist ../backend/static
cd ../backend && python -m uvicorn main:app --host 0.0.0.0 --port 8004
```

### Docker

```bash
docker build -t foundry-observability .
docker run -p 8004:8004 --env-file .env foundry-observability
```

## Rate Limit Hierarchy

When a request arrives, APIM evaluates limits in this order (first match wins):

1. **Per-User** — Individual APIM subscription TPM
2. **Per-Group** — Shared TPM across group members
3. **Per-Deployment** — Model-specific limit
4. **Global Default** — Catch-all fallback

## Budget → TPM Conversion

```
blended_rate   = (input_price × 0.75 + output_price × 0.25) / 1,000,000
monthly_tokens = budget / blended_rate
TPM            = monthly_tokens / 43,200  (30d × 24h × 60min)
```

Pricing sourced from Azure OpenAI Global Standard tier. Assumes uniform usage distribution across the month.

## APIM Policy Structure

The generated policy includes:
- `authentication-managed-identity` for backend auth
- `set-header` for Authorization and api-key
- `llm-token-limit` blocks for user → group → deployment rate limits
- Epoch-based counter-key suffixes to ensure fresh sliding-window counters on each Apply
- `emit-metric` with dimensions: Subscription ID, Model Deployment, Status

## License

© Ben Dali. All rights reserved.
