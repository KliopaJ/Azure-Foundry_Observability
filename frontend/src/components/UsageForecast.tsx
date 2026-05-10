import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { useApiClient } from '../api/client'
import { useApp } from '../context/AppContext'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import { ModelPricing, getModelPricing, getCost } from '../pricing'

function fmtNum(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toString()
}

function fmtCost(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(3)}`
  return `$${n.toFixed(4)}`
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

const TOOLTIP_STYLE: React.CSSProperties = {
  fontSize: 11, borderRadius: 8,
  border: '1px solid var(--tooltip-border)',
  background: 'var(--tooltip-bg)',
  color: 'var(--tooltip-text)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
}

const WINDOWS = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
]

// ── Users / Groups (mirrored from backend) ───────────────────────────────────
const USERS = [
  { apimSub: 'peter-parker',   display: 'Peter Parker',    group: 'superheroes' },
  { apimSub: 'tonny-stark',    display: 'Tonny Stark',     group: 'superheroes' },
  { apimSub: 'son-goku',       display: 'Son Goku',        group: 'manga' },
  { apimSub: 'monkey-d-luffy', display: 'Monkey D. Luffy', group: 'manga' },
]
const GROUPS: Record<string, { display: string; color: string; members: string[] }> = {
  superheroes: { display: 'Superheroes', color: '#3b82f6', members: ['peter-parker', 'tonny-stark'] },
  manga:       { display: 'Manga',       color: '#8b5cf6', members: ['son-goku', 'monkey-d-luffy'] },
}

// ── Types ────────────────────────────────────────────────────────────────────
interface DeploymentUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requests: number
}

interface ResourceForecast {
  resource: string
  rg: string
  subId: string
  subName: string
  projects: string[]
  deployments: Record<string, DeploymentUsage>
}

interface UsersGroupsData {
  users: { apimSub: string; display: string; group: string; success: number; blocked: number; total: number }[]
  groups: { groupId: string; display: string; members: string[]; success: number; blocked: number; total: number }[]
  userModelStats: { apimSub: string; deployment: string; calls: number; blocked: number }[]
}

export default function UsageForecast() {
  const { get } = useApiClient()
  const { config } = useApp()
  const [windowDays, setWindowDays] = useState(7)

  const start = format(startOfDay(subDays(new Date(), windowDays)), "yyyy-MM-dd'T'HH:mm:ss")
  const end   = format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm:ss")

  const { data: forecastData = [], isFetching } = useQuery<ResourceForecast[]>({
    queryKey: ['forecast', start, end],
    queryFn: () => get('/api/forecast', { start, end, granularity: 'P1D' }),
  })

  const { data: usersGroups } = useQuery<UsersGroupsData>({
    queryKey: ['users-groups-forecast', config.apimSubId, config.apimRg, config.apimName, start, end],
    queryFn: () => get('/api/users-groups', {
      sub_id: config.apimSubId, rg: config.apimRg, apim: config.apimName,
      start, end,
    }),
    enabled: !!config.apimSubId && !!config.apimRg && !!config.apimName,
  })

  // Compute cost per resource
  const resourceCosts = useMemo(() =>
    forecastData.map(r => {
      let cost = 0, totalTokens = 0, requests = 0
      Object.entries(r.deployments).forEach(([dep, u]) => {
        cost += getCost(dep, u.inputTokens, u.outputTokens)
        totalTokens += u.totalTokens
        requests += u.requests
      })
      return { ...r, cost, totalTokens, requests }
    }).sort((a, b) => b.cost - a.cost),
    [forecastData],
  )

  // Aggregate by subscription
  const subCosts = useMemo(() => {
    const map = new Map<string, { subId: string; subName: string; cost: number; tokens: number; requests: number; resources: number }>()
    resourceCosts.forEach(r => {
      const existing = map.get(r.subId)
      if (existing) {
        existing.cost += r.cost
        existing.tokens += r.totalTokens
        existing.requests += r.requests
        existing.resources += 1
      } else {
        map.set(r.subId, { subId: r.subId, subName: r.subName, cost: r.cost, tokens: r.totalTokens, requests: r.requests, resources: 1 })
      }
    })
    return [...map.values()].sort((a, b) => b.cost - a.cost)
  }, [resourceCosts])

  // Aggregate by project (flatten across resources)
  const projectCosts = useMemo(() => {
    const map = new Map<string, { project: string; resource: string; subName: string; cost: number; tokens: number }>()
    resourceCosts.forEach(r => {
      const projects = r.projects.length > 0 ? r.projects : ['(no project)']
      const costPerProject = r.cost / projects.length
      const tokensPerProject = r.totalTokens / projects.length
      projects.forEach(p => {
        const key = `${r.subId}/${r.resource}/${p}`
        const existing = map.get(key)
        if (existing) {
          existing.cost += costPerProject
          existing.tokens += tokensPerProject
        } else {
          map.set(key, { project: p, resource: r.resource, subName: r.subName, cost: costPerProject, tokens: tokensPerProject })
        }
      })
    })
    return [...map.values()].sort((a, b) => b.cost - a.cost)
  }, [resourceCosts])

  // Monthly forecast: scale observed window to 30 days
  const scaleFactor = 30 / windowDays

  const totalObservedCost = resourceCosts.reduce((s, r) => s + r.cost, 0)
  const totalForecastCost = totalObservedCost * scaleFactor
  const totalObservedTokens = resourceCosts.reduce((s, r) => s + r.totalTokens, 0)
  const totalObservedRequests = resourceCosts.reduce((s, r) => s + r.requests, 0)

  // User & group cost estimation
  const avgCostPerReq = totalObservedRequests > 0 ? totalObservedCost / totalObservedRequests : 0

  const userCosts = useMemo(() => {
    if (!usersGroups) return []
    return usersGroups.users.map(u => ({
      ...u,
      observedCost: u.success * avgCostPerReq,
      forecastCost: u.success * avgCostPerReq * scaleFactor,
    })).sort((a, b) => b.forecastCost - a.forecastCost)
  }, [usersGroups, avgCostPerReq, scaleFactor])

  const groupCosts = useMemo(() => {
    if (!usersGroups) return []
    return usersGroups.groups.map(g => {
      const memberCost = userCosts
        .filter(u => u.group === g.groupId)
        .reduce((s, u) => s + u.observedCost, 0)
      return {
        ...g,
        observedCost: memberCost,
        forecastCost: memberCost * scaleFactor,
      }
    }).sort((a, b) => b.forecastCost - a.forecastCost)
  }, [usersGroups, userCosts, scaleFactor])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Usage Forecast</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Monthly cost projection based on last {windowDays} days of usage across all subscriptions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Lookback window:</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            {WINDOWS.map(w => (
              <button
                key={w.days}
                onClick={() => setWindowDays(w.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  windowDays === w.days
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 bg-white dark:bg-gray-900'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          {isFetching && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 xl:gap-4">
        {[
          { label: 'Monthly Forecast', value: fmtCost(totalForecastCost), sub: `based on ${windowDays}d window` },
          { label: `Observed (${windowDays}d)`, value: fmtCost(totalObservedCost), sub: `${fmtNum(totalObservedTokens)} tokens` },
          { label: 'Subscriptions', value: String(subCosts.length), sub: 'with usage' },
          { label: 'Foundry Resources', value: String(resourceCosts.filter(r => r.cost > 0).length), sub: 'with usage' },
          { label: 'Projects', value: String(projectCosts.filter(p => p.cost > 0 && p.project !== '(no project)').length), sub: 'across resources' },
          { label: 'Total Requests', value: fmtNum(totalObservedRequests), sub: `${windowDays}d window` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 xl:p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</div>
            <div className="text-2xl xl:text-3xl font-bold text-gray-900 dark:text-white">{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      {/* Top Subscriptions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
        <ChartCard title="Top Subscriptions — Monthly Forecast (USD)">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={subCosts.slice(0, 10).map(s => ({ name: s.subName, forecast: s.cost * scaleFactor, observed: s.cost }))}
                layout="vertical" margin={{ left: 8, right: 60 }}
              >
                <defs>
                  <linearGradient id="gradFcSub" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.7}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={v => fmtCost(v)} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                <Tooltip formatter={(v: number, name: string) => [fmtCost(v), name === 'forecast' ? 'Monthly forecast' : 'Observed']} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--chart-text)' }} />
                <Bar dataKey="forecast" name="Monthly forecast" fill="url(#gradFcSub)" radius={[0, 4, 4, 0]} maxBarSize={28}
                  label={{ position: 'right', formatter: (v: number) => v > 0 ? fmtCost(v) : '', fontSize: 9, fill: '#9ca3af' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Top Foundry Resources */}
        <ChartCard title="Top Foundry Resources — Monthly Forecast (USD)">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={resourceCosts.slice(0, 10).map(r => ({ name: r.resource, forecast: r.cost * scaleFactor, sub: r.subName }))}
                layout="vertical" margin={{ left: 8, right: 60 }}
              >
                <defs>
                  <linearGradient id="gradFcRes" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.7}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={v => fmtCost(v)} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                <Tooltip
                  formatter={(v: number) => [fmtCost(v), 'Monthly forecast']}
                  labelFormatter={(label: string) => {
                    const item = resourceCosts.find(r => r.resource === label)
                    return item ? `${label} (${item.subName})` : label
                  }}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="forecast" name="Monthly forecast" fill="url(#gradFcRes)" radius={[0, 4, 4, 0]} maxBarSize={28}
                  label={{ position: 'right', formatter: (v: number) => v > 0 ? fmtCost(v) : '', fontSize: 9, fill: '#9ca3af' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Top Projects + Cost distribution pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
        <ChartCard title="Top Projects — Monthly Forecast (USD)">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={projectCosts.slice(0, 10).map(p => ({ name: `${p.project}`, forecast: p.cost * scaleFactor, resource: p.resource }))}
                layout="vertical" margin={{ left: 8, right: 60 }}
              >
                <defs>
                  <linearGradient id="gradFcProj" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.7}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={v => fmtCost(v)} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                <Tooltip
                  formatter={(v: number) => [fmtCost(v), 'Monthly forecast']}
                  labelFormatter={(label: string) => {
                    const item = projectCosts.find(p => p.project === label)
                    return item ? `${label} → ${item.resource}` : label
                  }}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="forecast" name="Monthly forecast" fill="url(#gradFcProj)" radius={[0, 4, 4, 0]} maxBarSize={28}
                  label={{ position: 'right', formatter: (v: number) => v > 0 ? fmtCost(v) : '', fontSize: 9, fill: '#9ca3af' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Cost Distribution by Subscription">
          <div className="h-[260px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="90%">
              <PieChart>
                <Pie
                  data={subCosts.map(s => ({ name: s.subName, value: s.cost * scaleFactor }))}
                  cx="50%" cy="50%" innerRadius="45%" outerRadius="75%"
                  dataKey="value" nameKey="name"
                  label={({ name, percent }) => `${name.length > 18 ? name.slice(0, 18) + '…' : name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {subCosts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtCost(v)} contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* User & Group forecast */}
      {userCosts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
          <ChartCard title="Monthly Forecast per User (USD)">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={userCosts.map(u => ({ name: u.display, forecast: u.forecastCost }))}
                  layout="vertical" margin={{ left: 0, right: 52 }}
                >
                  <defs>
                    <linearGradient id="gradFcUser" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.6}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickFormatter={v => fmtCost(v)} tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip formatter={(v: number) => [fmtCost(v), 'Monthly forecast']} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="forecast" fill="url(#gradFcUser)" radius={[0, 4, 4, 0]} maxBarSize={28}
                    label={{ position: 'right', formatter: (v: number) => v > 0 ? fmtCost(v) : '', fontSize: 9, fill: '#9ca3af' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
          <ChartCard title="Monthly Forecast per Group (USD)">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={groupCosts.map(g => ({ name: g.display, forecast: g.forecastCost, groupId: g.groupId }))}
                  layout="vertical" margin={{ left: 0, right: 52 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickFormatter={v => fmtCost(v)} tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip formatter={(v: number) => [fmtCost(v), 'Monthly forecast']} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="forecast" radius={[0, 4, 4, 0]} maxBarSize={28}
                    label={{ position: 'right', formatter: (v: number) => v > 0 ? fmtCost(v) : '', fontSize: 9, fill: '#9ca3af' }}>
                    {groupCosts.map((g, i) => <Cell key={i} fill={GROUPS[g.groupId]?.color ?? COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {/* Subscription breakdown table */}
      <TableCard title="Subscription Forecast Breakdown">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              {['Subscription', 'Resources', 'Tokens', 'Requests', `Observed (${windowDays}d)`, 'Monthly Forecast'].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {subCosts.map(s => (
              <tr key={s.subId} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{s.subName}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{s.resources}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(s.tokens)}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(s.requests)}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtCost(s.cost)}</td>
                <td className="px-5 py-3 font-semibold text-gray-900 dark:text-white">{fmtCost(s.cost * scaleFactor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {/* Resource breakdown table */}
      <TableCard title="Foundry Resource Forecast Breakdown">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              {['Resource', 'Subscription', 'Deployments', 'Tokens', 'Requests', `Observed (${windowDays}d)`, 'Monthly Forecast'].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {resourceCosts.map(r => (
              <tr key={`${r.subId}/${r.resource}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <td className="px-5 py-3 font-mono text-xs text-gray-900 dark:text-white">{r.resource}</td>
                <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{r.subName}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{Object.keys(r.deployments).length}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(r.totalTokens)}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(r.requests)}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtCost(r.cost)}</td>
                <td className="px-5 py-3 font-semibold text-gray-900 dark:text-white">{fmtCost(r.cost * scaleFactor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {/* User forecast table */}
      {userCosts.length > 0 && (
        <TableCard title="User Forecast Breakdown">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {['User', 'Group', 'Requests', `Observed (${windowDays}d)`, 'Monthly Forecast'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {userCosts.map(u => (
                <tr key={u.apimSub} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{u.display}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                      style={{ backgroundColor: GROUPS[u.group]?.color ?? '#6b7280' }}>
                      {GROUPS[u.group]?.display ?? u.group}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(u.success)}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtCost(u.observedCost)}</td>
                  <td className="px-5 py-3 font-semibold text-gray-900 dark:text-white">{fmtCost(u.forecastCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      {/* Group forecast table */}
      {groupCosts.length > 0 && (
        <TableCard title="Group Forecast Breakdown">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {['Group', 'Members', 'Requests', `Observed (${windowDays}d)`, 'Monthly Forecast'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {groupCosts.map(g => (
                <tr key={g.groupId} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                      style={{ backgroundColor: GROUPS[g.groupId]?.color ?? '#6b7280' }}>
                      {g.display}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{g.members.join(', ')}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(g.total)}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtCost(g.observedCost)}</td>
                  <td className="px-5 py-3 font-semibold text-gray-900 dark:text-white">{fmtCost(g.forecastCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 xl:p-5">
      <div className="flex items-center gap-1.5 mb-3 xl:mb-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</span>
      </div>
      {children}
    </div>
  )
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 font-medium text-sm text-gray-900 dark:text-white">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}
