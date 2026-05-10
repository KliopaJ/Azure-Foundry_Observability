import { BarChart2, Settings, ShieldCheck, Container, BookOpen, TrendingUp, Gauge, Users, Globe, Layers } from 'lucide-react'

const features = [
  {
    icon: <BarChart2 size={22} className="text-blue-500" />,
    title: 'Dashboard',
    description:
      'Real-time token usage metrics — InputTokens, OutputTokens, TotalTokens, and ModelRequests — per deployment with cost estimation. Includes token trend charts, input vs. output breakdown, requests by deployment, estimated cost per deployment, and a full deployment summary table. Supports hourly, daily, weekly, and monthly granularity with 1D / 7D / 14D / 30D date ranges. Features a Users & Groups section with per-user and per-group cost estimation, request charts, and model usage breakdown.',
  },
  {
    icon: <Settings size={22} className="text-amber-500" />,
    title: 'Settings',
    description:
      'Manage APIM rate limits across three layers — per-user, per-group, and per-deployment — with support for both TPM (tokens-per-minute) and monthly dollar budget modes. View the live policy XML fetched directly from APIM (VS Code-style syntax with line numbers), configure cost limits, and apply or reset policies. Budget amounts are automatically converted to TPM using Azure OpenAI model pricing. Each Apply generates epoch-based counter keys to prevent stale 429s from prior configurations.',
  },
  {
    icon: <TrendingUp size={22} className="text-emerald-500" />,
    title: 'Usage Forecast',
    description:
      'Monthly cost projection based on observed usage across all subscriptions and Foundry resources. Select a lookback window (7 / 14 / 30 days) to extrapolate to 30-day forecasts. Shows top subscriptions, top resources, and top projects by estimated cost, plus per-user and per-group forecast charts. Includes cost distribution pie chart and detailed breakdown tables.',
  },
  {
    icon: <Gauge size={22} className="text-violet-500" />,
    title: 'Provisioned Quotas',
    description:
      'Cross-subscription view of all provisioned TPM and RPM quotas for every model deployment. Aggregate by resource, model, region, or subscription with interactive charts and a full deployment table with sortable columns, grouping, search, and direct links to the Azure Portal quota request form.',
  },
  {
    icon: <ShieldCheck size={22} className="text-green-500" />,
    title: 'Multi-user Auth (MSAL)',
    description:
      'MSAL.js Entra ID sign-in — each user authenticates with their own Azure account. Azure RBAC enforces permissions automatically; no shared credentials or service-principal tokens are embedded in the frontend. ARM tokens are acquired per-request for management API calls.',
  },
  {
    icon: <Globe size={22} className="text-cyan-500" />,
    title: 'Multi-subscription & Multi-resource',
    description:
      'Browse and monitor all Azure AI Foundry resources across all subscriptions. The context bar supports "All subscriptions" and "All resources" modes, using Azure Resource Graph for instant cross-tenant discovery. Projects are fetched per Foundry resource.',
  },
  {
    icon: <Users size={22} className="text-pink-500" />,
    title: 'User & Group Governance',
    description:
      'APIM policy enforcement with per-user and per-group rate limits using llm-token-limit. Usage telemetry flows through emit-metric to Log Analytics with dimensions for subscription, deployment, and status. Dashboard shows active users, blocked requests, and estimated costs per user and group.',
  },
  {
    icon: <Container size={22} className="text-purple-500" />,
    title: 'Container-ready',
    description:
      'Runs as a single Docker container: the React frontend is built and served by the FastAPI backend with no separate web server required. Deploy to Azure Container Apps, Azure App Service, or any Docker host with a single image. Includes automated setup scripts: register-entra-app.sh (Entra ID app registration) and wire-apim.sh (auto-discovers and wires APIM to all Foundry resources across the tenant).',
  },
]

const fieldReference = [
  { field: 'Global Default TPM', desc: 'Fallback tokens-per-minute limit applied when no user, group, or deployment-specific limit matches.', enforced: 'apim' },
  { field: 'Per-Deployment: Rate limit (TPM)', desc: 'Max tokens per minute for a specific model deployment, enforced via azure-openai-token-limit policy.', enforced: 'apim' },
  { field: 'Per-Deployment: Monthly budget ($)', desc: 'Dollar budget converted to an equivalent TPM using the model\'s pricing (blended 75% input / 25% output). Enforced by APIM.', enforced: 'apim' },
  { field: 'Per-Group: Rate limit (TPM)', desc: 'Shared token rate limit for all users in a group. Each member\'s requests count toward the same counter.', enforced: 'apim' },
  { field: 'Per-Group: Monthly budget ($)', desc: 'Monthly cost cap per group converted to equivalent TPM. Progress shown in Dashboard.', enforced: 'apim' },
  { field: 'Per-User: Rate limit (TPM)', desc: 'Individual token rate limit per APIM subscription. Hard-enforced — requests exceeding get HTTP 429.', enforced: 'apim' },
  { field: 'Per-User: Monthly budget ($)', desc: 'Monthly cost cap per user converted to equivalent TPM. Progress shown in Dashboard.', enforced: 'apim' },
  { field: 'Monthly Budget — Project ($)', desc: 'Global project-wide dollar budget for cost tracking across all users and deployments (informational).', enforced: 'info' },
  { field: 'Epoch Counter Keys', desc: 'Each Apply generates a fresh epoch timestamp in counter keys. This prevents stale APIM sliding-window counters from prior rate-limit configurations from causing unexpected 429s.', enforced: 'apim' },
]

function EnforcedBadge({ type }: { type: string }) {
  if (type === 'apim') return (
    <span className="inline-flex px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-full text-[10px] font-semibold tracking-wide">APIM Enforced</span>
  )
  return (
    <span className="inline-flex px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-full text-[10px] font-semibold tracking-wide">Informational</span>
  )
}

export default function About() {
  return (
    <div className="space-y-8">
      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 rounded-2xl border border-gray-200 dark:border-gray-800 px-8 py-10">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Foundry Observability</h1>
        <p className="text-base text-gray-500 dark:text-gray-400 max-w-2xl">
          A comprehensive multi-user platform for monitoring Azure AI Foundry usage, forecasting costs, managing APIM token rate limits, and tracking provisioned quotas — across all subscriptions and resources in one place.
        </p>
      </div>

      {/* ── Features grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {features.map(({ icon, title, description }) => (
          <div
            key={title}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 flex gap-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
          >
            <div className="mt-0.5 flex-shrink-0 w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center">{icon}</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1.5">{title}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Architecture Overview ───────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-8 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-50 dark:bg-cyan-900/20 flex items-center justify-center">
            <Layers size={16} className="text-cyan-500" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Architecture</h2>
            <p className="text-xs text-gray-400">System components and data flow</p>
          </div>
        </div>
        <div className="px-8 py-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: 'Frontend', color: 'blue', items: ['React + TypeScript', 'TanStack Query (data fetching)', 'Recharts (visualizations)', 'Tailwind CSS (styling)', 'MSAL.js (Entra ID auth)', 'Vite (build tool)'] },
              { label: 'Backend', color: 'green', items: ['FastAPI + uvicorn', 'ARM REST API (Azure Monitor metrics)', 'Azure Resource Graph (cross-sub queries)', 'APIM Management API (policy CRUD)', 'Log Analytics / KQL (user telemetry)', 'Serves SPA + API on same port'] },
              { label: 'Azure Services', color: 'violet', items: ['Azure AI Foundry (models)', 'API Management (governance)', 'Azure Monitor (metrics)', 'Log Analytics (emit-metric data)', 'Entra ID (authentication)', 'Azure Resource Graph'] },
            ].map(({ label, color, items }) => (
              <div key={label} className={`rounded-xl border border-${color}-200 dark:border-${color}-800 bg-${color}-50/30 dark:bg-${color}-900/10 p-5`}>
                <div className={`text-xs font-bold text-${color}-700 dark:text-${color}-300 uppercase tracking-wider mb-3`}>{label}</div>
                <ul className="space-y-1.5">
                  {items.map(item => (
                    <li key={item} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                      <span className={`w-1 h-1 rounded-full bg-${color}-400 mt-1.5 flex-shrink-0`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* API Endpoints */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">API Endpoints</h3>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-300 w-[200px]">Endpoint</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-300 w-[80px]">Method</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-gray-300">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {[
                    { ep: '/api/config', method: 'GET', desc: 'Returns APIM configuration (name, subscription, resource group, API ID, backend ID, default TPM)' },
                    { ep: '/api/subscriptions', method: 'GET', desc: 'Lists all enabled Azure subscriptions for the authenticated user' },
                    { ep: '/api/foundry-resources', method: 'GET', desc: 'Lists AI Foundry / OpenAI / Cognitive Services accounts (supports __all__ for cross-sub Resource Graph query)' },
                    { ep: '/api/projects', method: 'GET', desc: 'Lists projects under a specific Foundry resource' },
                    { ep: '/api/deployments', method: 'GET', desc: 'Lists model deployments for a Foundry resource' },
                    { ep: '/api/metrics', method: 'GET', desc: 'Queries Azure Monitor for token usage metrics (InputTokens, OutputTokens, TotalTokens, ModelRequests)' },
                    { ep: '/api/forecast', method: 'GET', desc: 'Aggregates metrics across all resources for cost forecasting with parallel per-resource metric fetching' },
                    { ep: '/api/quotas', method: 'GET', desc: 'Returns provisioned TPM/RPM quotas for every deployment across all subscriptions' },
                    { ep: '/api/policy', method: 'GET', desc: 'Fetches and parses the current APIM policy XML (user, group, deployment limits)' },
                    { ep: '/api/policy', method: 'PUT', desc: 'Builds and applies a new APIM policy with rate limits, auth, and emit-metric' },
                    { ep: '/api/policy', method: 'DELETE', desc: 'Resets APIM policy to a minimal pass-through configuration' },
                    { ep: '/api/users-groups', method: 'GET', desc: 'Queries Log Analytics (KQL) for per-user and per-group request stats with model breakdown' },
                    { ep: '/api/cost-limits', method: 'GET/PUT', desc: 'Reads or writes cost limit configuration (per-user, per-group, per-deployment budgets)' },
                    { ep: '/api/pricing', method: 'GET', desc: 'Returns scraped Azure pricing for all supported models (OpenAI, DeepSeek, Kimi, Llama, Phi)' },
                  ].map(({ ep, method, desc }) => (
                    <tr key={ep + method} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-gray-800 dark:text-gray-200">{ep}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          method === 'GET' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' :
                          method === 'PUT' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' :
                          method === 'DELETE' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' :
                          'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}>{method}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── Documentation ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-8 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
            <BookOpen size={16} className="text-indigo-500" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Documentation</h2>
            <p className="text-xs text-gray-400">Settings fields, rate limit hierarchy, and budget conversion</p>
          </div>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Rate Limit Hierarchy */}
          <div className="px-8 py-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Rate Limit Hierarchy</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              When a request arrives, APIM evaluates limits in this order — first match wins:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { n: '1', label: 'Per-User', sub: 'Individual subscription TPM', color: 'blue' },
                { n: '2', label: 'Per-Group', sub: 'Shared TPM across group members', color: 'violet' },
                { n: '3', label: 'Per-Deployment', sub: 'Model-specific limit', color: 'amber' },
                { n: '4', label: 'Global Default', sub: 'Catch-all fallback', color: 'gray' },
              ].map(({ n, label, sub, color }) => (
                <div key={n} className={`rounded-lg border border-${color}-200 dark:border-${color}-800 bg-${color}-50/50 dark:bg-${color}-900/10 px-4 py-3`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-5 h-5 rounded-full bg-${color}-500 text-white text-[10px] font-bold flex items-center justify-center`}>{n}</span>
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{label}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Field Reference */}
          <div className="px-8 py-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Field Reference</h3>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-[240px]">Field</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Description</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-[130px]">Enforcement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {fieldReference.map(({ field, desc, enforced }) => (
                    <tr key={field} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">{field}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{desc}</td>
                      <td className="px-4 py-3"><EnforcedBadge type={enforced} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* TPM vs Budget */}
          <div className="px-8 py-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">TPM vs Monthly Budget Mode</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 p-5">
                <div className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider mb-2">Rate Limit (TPM)</div>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  Set an explicit tokens-per-minute value. APIM enforces it directly — requests exceeding the limit receive HTTP 429 with a Retry-After header.
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-5">
                <div className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-2">Monthly Budget ($)</div>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  Set a dollar amount per month. The system converts it to an equivalent TPM using the model&apos;s Azure pricing (blended 75% input / 25% output). The token equivalent hint shows how many tokens your budget buys.
                </p>
              </div>
            </div>
          </div>

          {/* Conversion Formula */}
          <div className="px-8 py-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Budget → TPM Conversion</h3>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl px-6 py-5 space-y-2 font-mono text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
              <p><span className="text-blue-600 dark:text-blue-400">blended_rate</span> = (input_price × 0.75 + output_price × 0.25) / 1,000,000</p>
              <p><span className="text-green-600 dark:text-green-400">monthly_tokens</span> = budget / blended_rate</p>
              <p><span className="text-amber-600 dark:text-amber-400">TPM</span> = monthly_tokens / 43,200 <span className="text-gray-400">(30d × 24h × 60min)</span></p>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Pricing sourced from Azure OpenAI Global Standard tier. Assumes uniform usage distribution across the month.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
