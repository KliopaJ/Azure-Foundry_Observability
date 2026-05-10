import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { format, subDays, startOfDay, endOfDay, parseISO, startOfWeek, startOfMonth } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { useApiClient } from '../api/client'
import { useApp } from '../context/AppContext'
import { UsageRow, DepSummary, DeploymentInfo, FoundryResource, UsersGroupsData, CostLimits } from '../types'
import { ModelPricing, MODEL_PRICING, MODEL_PRICING_DEFAULT, getModelPricing, getCost, getCostBlended } from '../pricing'

const PRESETS = [
  { label: '1D', days: 1 },
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '1M', days: 30 },
]

const GRANULARITIES = [
  { value: 'PT1H', label: 'Hourly',  apiInterval: 'PT1H', bucket: null },
  { value: 'P1D',  label: 'Daily',   apiInterval: 'P1D',  bucket: null },
  { value: 'P1W',  label: 'Weekly',  apiInterval: 'P1D',  bucket: 'week'  as const },
  { value: 'P1M',  label: 'Monthly', apiInterval: 'P1D',  bucket: 'month' as const },
]

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

const GROUP_COLORS: Record<string, string> = {
  superheroes: '#3b82f6',
  manga: '#8b5cf6',
}

const DEP_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

const TOOLTIP_STYLE: React.CSSProperties = {
  fontSize: 11, borderRadius: 8,
  border: '1px solid var(--tooltip-border)',
  background: 'var(--tooltip-bg)',
  color: 'var(--tooltip-text)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
}

const CHART_TEXT: React.CSSProperties = { color: 'var(--chart-text)' }

function fmtNum(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toString()
}

export default function Dashboard() {
  const { get } = useApiClient()
  const { subId, rg, foundryName, config } = useApp()
  const [preset, setPreset] = useState<number | null>(7)
  const [granularity, setGranularity] = useState('PT1H')

  // Custom date range
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const [customFrom, setCustomFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(todayStr)
  const [appliedFrom, setAppliedFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [appliedTo, setAppliedTo] = useState(todayStr)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const start = preset !== null
    ? format(startOfDay(subDays(new Date(), preset)), "yyyy-MM-dd'T'HH:mm:ss")
    : `${appliedFrom}T00:00:00`
  const end = preset !== null
    ? format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm:ss")
    : `${appliedTo}T23:59:59`

  // Azure Monitor only supports up to P1D; weekly/monthly are bucketed client-side
  const granCfg = GRANULARITIES.find(g => g.value === granularity) ?? GRANULARITIES[0]
  const apiInterval = granCfg.apiInterval
  const bucketMode  = granCfg.bucket

  const isAllResources = foundryName === '__all__'

  // Resources list — shared cache with ContextBar, needed for "All resources" parallel queries
  const { data: resources = [] } = useQuery<FoundryResource[]>({
    queryKey: ['resources', subId],
    queryFn: () => get('/api/foundry-resources', { sub_id: subId }),
    enabled: !!subId,
  })

  // Resolve effective sub/rg when a specific resource is selected under "All subscriptions"
  const selectedResource = !isAllResources ? resources.find(r => r.name === foundryName) : null
  const effectiveSubId = selectedResource?.subId ?? subId
  const effectiveRg = selectedResource?.rg ?? rg

  // Metrics — single resource
  const { data: rawRowsSingle = [], isFetching: isFetchingSingle, isError: isErrorSingle } = useQuery<UsageRow[]>({
    queryKey: ['metrics', effectiveSubId, effectiveRg, foundryName, start, end, apiInterval],
    queryFn: () => get('/api/metrics', { sub_id: effectiveSubId, rg: effectiveRg, foundry: foundryName, start, end, granularity: apiInterval }),
    enabled: !isAllResources && !!effectiveSubId && effectiveSubId !== '__all__' && !!effectiveRg && !!foundryName,
  })

  // Metrics — all resources (parallel)
  const allMetricsResults = useQueries({
    queries: isAllResources ? resources.map(r => ({
      queryKey: ['metrics', r.subId ?? subId, r.rg, r.name, start, end, apiInterval],
      queryFn: () => get<UsageRow[]>('/api/metrics', {
        sub_id: r.subId ?? subId,
        rg: r.rg,
        foundry: r.name,
        start, end,
        granularity: apiInterval,
      }),
    })) : [],
  })

  const rawRows = isAllResources
    ? allMetricsResults.flatMap(r => r.data ?? [])
    : rawRowsSingle
  const isFetching = isAllResources
    ? allMetricsResults.some(r => r.isFetching)
    : isFetchingSingle
  const isError = isAllResources
    ? allMetricsResults.length > 0 && allMetricsResults.every(r => r.isError)
    : isErrorSingle

  // Bucket daily rows into weekly/monthly when requested
  const rows = useMemo<UsageRow[]>(() => {
    if (!bucketMode) return rawRows
    const map = new Map<string, UsageRow>()
    rawRows.forEach(r => {
      const d = new Date(r.timestamp)
      const bucketDate = bucketMode === 'week' ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d)
      const key = `${r.deployment}|${bucketDate.toISOString()}`
      const existing = map.get(key)
      if (existing) {
        existing.inputTokens  += r.inputTokens
        existing.outputTokens += r.outputTokens
        existing.totalTokens  += r.totalTokens
        existing.requests     += r.requests
      } else {
        map.set(key, { ...r, timestamp: bucketDate.toISOString() })
      }
    })
    return [...map.values()].sort((a, b) => a.deployment.localeCompare(b.deployment) || a.timestamp.localeCompare(b.timestamp))
  }, [rawRows, bucketMode])

  // Deployments — single resource
  const { data: deploymentInfosSingle = [] } = useQuery<DeploymentInfo[]>({
    queryKey: ['deployments', effectiveSubId, effectiveRg, foundryName],
    queryFn: () => get('/api/deployments', { sub_id: effectiveSubId, rg: effectiveRg, foundry: foundryName }),
    enabled: !isAllResources && !!effectiveSubId && effectiveSubId !== '__all__' && !!effectiveRg && !!foundryName,
  })

  // Deployments — all resources (parallel)
  const allDeploymentsResults = useQueries({
    queries: isAllResources ? resources.map(r => ({
      queryKey: ['deployments', r.subId ?? subId, r.rg, r.name],
      queryFn: () => get<DeploymentInfo[]>('/api/deployments', {
        sub_id: r.subId ?? subId,
        rg: r.rg,
        foundry: r.name,
      }),
    })) : [],
  })

  const deploymentInfos = useMemo(() => {
    const all = isAllResources
      ? allDeploymentsResults.flatMap(r => r.data ?? [])
      : deploymentInfosSingle
    const seen = new Set<string>()
    return all.filter(d => {
      if (seen.has(d.name)) return false
      seen.add(d.name)
      return true
    })
  }, [isAllResources, allDeploymentsResults, deploymentInfosSingle])

  const { data: usersGroups } = useQuery<UsersGroupsData>({
    queryKey: ['users-groups', config.apimSubId, config.apimRg, config.apimName, start, end],
    queryFn: () => get('/api/users-groups', {
      sub_id: config.apimSubId, rg: config.apimRg, apim: config.apimName,
      start, end,
    }),
    enabled: !!config.apimSubId && !!config.apimRg && !!config.apimName,
  })

  // Map deployment name → model info for quick lookup
  const modelMap = useMemo(() =>
    Object.fromEntries(deploymentInfos.map(d => [d.name, { model: d.model, modelFormat: d.modelFormat }])),
    [deploymentInfos]
  )

  const deployments = useMemo(() => [...new Set(rows.map(r => r.deployment))].sort(), [rows])

  const summaries: DepSummary[] = useMemo(() =>
    deployments.map(dep => {
      const dr = rows.filter(r => r.deployment === dep)
      const inp = dr.reduce((s, r) => s + r.inputTokens, 0)
      const out = dr.reduce((s, r) => s + r.outputTokens, 0)
      const tot = dr.reduce((s, r) => s + r.totalTokens, 0)
      const req = dr.reduce((s, r) => s + r.requests, 0)
      const info = modelMap[dep] ?? { model: '', modelFormat: '' }
      return { deployment: dep, model: info.model, modelFormat: info.modelFormat, inputTokens: inp, outputTokens: out, totalTokens: tot, requests: req, cost: getCost(dep, inp, out) }
    }), [rows, deployments, modelMap])

  const totals = useMemo(() => ({
    input: summaries.reduce((s, d) => s + d.inputTokens, 0),
    output: summaries.reduce((s, d) => s + d.outputTokens, 0),
    total: summaries.reduce((s, d) => s + d.totalTokens, 0),
    requests: summaries.reduce((s, d) => s + d.requests, 0),
    cost: summaries.reduce((s, d) => s + d.cost, 0),
  }), [summaries])

  const topModel = useMemo(() => {
    if (!summaries.length) return null
    const top = [...summaries].sort((a, b) => b.totalTokens - a.totalTokens)[0]
    return top.model || top.deployment
  }, [summaries])

  const { data: costLimits } = useQuery<CostLimits>({
    queryKey: ['cost-limits'],
    queryFn: () => get('/api/cost-limits'),
  })

  const { data: policyData } = useQuery<{ limits: Record<string, number>; groupLimits: Record<string, number>; userLimits: Record<string, number>; defaultTpm: number }>({
    queryKey: ['policy', config.apimSubId, config.apimRg, config.apimName],
    queryFn: () => get('/api/policy', { sub_id: config.apimSubId, rg: config.apimRg, apim: config.apimName, api_id: config.apimApiId }),
    enabled: !!config.apimSubId && !!config.apimRg && !!config.apimName,
  })

  // pivot rows by timestamp for time-series charts
  const timeData = useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    rows.forEach(r => {
      if (!map.has(r.timestamp)) map.set(r.timestamp, { ts: new Date(r.timestamp).getTime() })
      const entry = map.get(r.timestamp)!
      entry[r.deployment]           = (entry[r.deployment]           ?? 0) + r.totalTokens
      entry[`inp_${r.deployment}`]  = (entry[`inp_${r.deployment}`]  ?? 0) + r.inputTokens
      entry[`out_${r.deployment}`]  = (entry[`out_${r.deployment}`]  ?? 0) + r.outputTokens
      entry[`req_${r.deployment}`]  = (entry[`req_${r.deployment}`]  ?? 0) + r.requests
    })
    const sorted = [...map.entries()].sort((a, b) => a[1].ts - b[1].ts).map(([, v]) => v)
    sorted.forEach(row => {
      let total = 0, inp = 0, out = 0, req = 0
      Object.entries(row).forEach(([k, v]) => {
        if (k === 'ts' || k.startsWith('_')) return
        if (k.startsWith('inp_')) inp += v
        else if (k.startsWith('out_')) out += v
        else if (k.startsWith('req_')) req += v
        else total += v
      })
      row._total    = total
      row._input    = inp
      row._output   = out
      row._requests = req
    })
    // 3-point moving average for mean trend line
    sorted.forEach((row, i) => {
      const w = sorted.slice(Math.max(0, i - 1), Math.min(sorted.length, i + 2))
      row._movAvg = w.reduce((s, r) => s + (r._total ?? 0), 0) / w.length
    })
    return sorted
  }, [rows])

  const depMeans = useMemo(() =>
    deployments.map((dep, i) => {
      const vals = timeData.map(r => (r[dep] as number) ?? 0).filter(v => v > 0)
      const total = vals.reduce((s, v) => s + v, 0)
      const mean  = vals.length > 0 ? Math.round(total / vals.length) : 0
      return { dep, total, mean, color: COLORS[i % COLORS.length] }
    }),
    [deployments, timeData]
  )

  if (!foundryName)
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-5 py-10 text-center text-sm text-gray-400">
          Select a Foundry resource to view token metrics.
        </div>
        {usersGroups && <UsersGroupsSection data={usersGroups} summaries={summaries} costLimits={costLimits} policyData={policyData} />}
        {!usersGroups && subId && rg && (
          <div className="text-center text-xs text-gray-400 animate-pulse">Loading users &amp; groups…</div>
        )}
      </div>
    )

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {isAllResources ? `All Foundry Resources (${resources.length})` : foundryName}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            {PRESETS.map(p => (
              <button
                key={p.days}
                onClick={() => { setPreset(p.days); setShowPicker(false) }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  preset === p.days
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 bg-white dark:bg-gray-900'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date range picker */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => { setPreset(null); setShowPicker(prev => !prev) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                preset === null
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              {preset === null
                ? `${format(parseISO(appliedFrom), 'MMM d')} – ${format(parseISO(appliedTo), 'MMM d, yyyy')}`
                : 'Custom'}
            </button>

            {showPicker && (
              <div className="absolute right-0 top-full mt-2 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-4 w-72">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">Custom date range</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase font-semibold text-gray-400 mb-1">From</label>
                    <input
                      type="date"
                      value={customFrom}
                      max={customTo}
                      onChange={e => setCustomFrom(e.target.value)}
                      className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-semibold text-gray-400 mb-1">To</label>
                    <input
                      type="date"
                      value={customTo}
                      min={customFrom}
                      max={todayStr}
                      onChange={e => setCustomTo(e.target.value)}
                      className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <button
                  onClick={() => { setAppliedFrom(customFrom); setAppliedTo(customTo); setShowPicker(false) }}
                  disabled={!customFrom || !customTo || customFrom > customTo}
                  className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          <select
            value={granularity}
            onChange={e => setGranularity(e.target.value)}
            className="text-xs text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {GRANULARITIES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          {isFetching && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
          Failed to load metrics. Check that the Foundry resource name is correct and you have Reader access.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 xl:gap-4">
        {[
          { label: 'Total Tokens', value: fmtNum(totals.total), sub: `${fmtNum(totals.input)} in / ${fmtNum(totals.output)} out` },
          { label: 'Input Tokens', value: fmtNum(totals.input) },
          { label: 'Completion Tokens', value: fmtNum(totals.output) },
          { label: 'Total Requests', value: fmtNum(totals.requests) },
          { label: 'Est. Cost', value: `$${totals.cost.toFixed(2)}`, sub: 'approx.' },
          { label: 'Top Model', value: topModel ?? '—', sub: 'by token volume' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 xl:p-5 2xl:p-6">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</div>
            <div className="text-2xl xl:text-3xl font-bold text-gray-900 dark:text-white">{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      {/* Token usage chart — full width, stacked bars + dashed mean trend */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 xl:p-5">
        <div className="flex items-start justify-between mb-3 xl:mb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Token Usage Over Time</span>
          {depMeans.length > 0 && (
            <div className="text-right shrink-0 ml-4">
              <div className="grid grid-cols-[auto_58px_58px] gap-x-3 text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">
                <span />
                <span className="text-right">Total</span>
                <span className="text-right">Mean/pt</span>
              </div>
              {depMeans.map(d => (
                <div key={d.dep} className="grid grid-cols-[auto_58px_58px] gap-x-3 items-center text-[10px] mb-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-gray-500 dark:text-gray-400 truncate max-w-[80px]">{d.dep}</span>
                  </span>
                  <span className="text-right font-semibold text-gray-700 dark:text-gray-200">{fmtNum(d.total)}</span>
                  <span className="text-right text-gray-400">{fmtNum(d.mean)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="h-[220px] md:h-[260px] lg:h-[300px] xl:h-[340px] 2xl:h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={timeData} barCategoryGap="18%">
              <defs>
                {deployments.map((dep, i) => (
                  <linearGradient key={dep} id={`tbar-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={COLORS[i % COLORS.length]} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.6}  />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="ts" tickFormatter={v => {
                const d = new Date(v)
                return bucketMode === 'month' ? format(d, 'MMM yyyy')
                     : bucketMode === 'week'  ? format(d, 'MMM d')
                     : granularity === 'P1D'  ? format(d, 'MM/dd')
                     : format(d, 'MM/dd HH:mm')
              }} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={fmtNum} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={v => {
                  const d = new Date(v)
                  return bucketMode === 'month' ? format(d, 'MMMM yyyy')
                       : bucketMode === 'week'  ? `Week of ${format(d, 'MMM d, yyyy')}`
                       : format(d, 'MM/dd HH:mm')
                }}
                formatter={(v: number, name: string) => [fmtNum(Math.round(v)), name === '_movAvg' ? 'Mean trend' : name]}
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend formatter={(value: string) => value === '_movAvg' ? '' : value} iconType="square" wrapperStyle={CHART_TEXT} />
              {deployments.map((dep, i) => (
                <Bar key={dep} dataKey={dep} stackId="stack" fill={`url(#tbar-${i})`} maxBarSize={56} />
              ))}
              <Line
                type="monotone" dataKey="_movAvg" stroke="#94a3b8"
                strokeDasharray="6 3" dot={false} strokeWidth={1.5}
                name="_movAvg" legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3 time-series charts: Input/Output area, Requests area, Cost horizontal bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 xl:gap-4">

        {/* Input vs Output Tokens over time — stacked area */}
        <ChartCard title="Input vs Output Tokens Over Time">
          <div className="h-[200px] md:h-[240px] xl:h-[280px] 2xl:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeData}>
                <defs>
                  <linearGradient id="gradInp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.75}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.75}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="ts" tickFormatter={v => {
                  const d = new Date(v)
                  return (bucketMode || granularity === 'P1D') ? format(d, 'MM/dd') : format(d, 'MM/dd HH:mm')
                }} tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={fmtNum} tick={{ fontSize: 10 }} />
                <Tooltip
                  labelFormatter={v => format(new Date(v), 'MM/dd HH:mm')}
                  formatter={(v: number, name: string) => [fmtNum(v), name]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={CHART_TEXT} />
                <Area type="monotone" dataKey="_input"  name="Input"  stackId="io" stroke="#3b82f6" fill="url(#gradInp)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="_output" name="Output" stackId="io" stroke="#10b981" fill="url(#gradOut)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Requests over time — area with purple gradient */}
        <ChartCard title="Requests Over Time">
          <div className="h-[200px] md:h-[240px] xl:h-[280px] 2xl:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeData}>
                <defs>
                  <linearGradient id="gradReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="gradReqLine" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#c4b5fd" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#c4b5fd" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="ts" tickFormatter={v => {
                  const d = new Date(v)
                  return (bucketMode || granularity === 'P1D') ? format(d, 'MM/dd') : format(d, 'MM/dd HH:mm')
                }} tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={fmtNum} tick={{ fontSize: 10 }} />
                <Tooltip
                  labelFormatter={v => format(new Date(v), 'MM/dd HH:mm')}
                  formatter={(v: number) => [fmtNum(v), 'Requests']}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Area type="monotone" dataKey="_requests" name="Requests" stroke="#8b5cf6" fill="url(#gradReq)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Cost by deployment — horizontal gradient bar */}
        <ChartCard title="Est. Cost by Deployment (USD)">
          <div className="h-[200px] md:h-[240px] xl:h-[280px] 2xl:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...summaries].sort((a, b) => b.cost - a.cost)} layout="vertical" margin={{ left: 8, right: 52 }}>
                <defs>
                  <linearGradient id="gradCost" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="#10b981" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.8}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={v => `$${v.toFixed(2)}`} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="deployment" tick={{ fontSize: 10 }} width={90} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, 'Est. Cost']} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="cost" fill="url(#gradCost)" radius={[0, 4, 4, 0]} maxBarSize={28}
                  label={{ position: 'right', formatter: (v: number) => v > 0 ? `$${v.toFixed(3)}` : '', fontSize: 9, fill: '#9ca3af' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Summary table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 font-medium text-sm text-gray-900 dark:text-white">
          Deployment Summary
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {['Deployment', 'Model', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Share', 'Requests', 'Est. Cost'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {summaries.map(s => (
                <tr key={s.deployment} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-gray-900 dark:text-white">{s.deployment}</td>
                  <td className="px-5 py-3 text-xs">
                    {s.model ? (
                      <a
                        href={`https://ai.azure.com/catalog/models/${encodeURIComponent(s.model)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        title={`View ${s.model} in Azure AI Catalog`}
                      >
                        {s.model}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(s.inputTokens)}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(s.outputTokens)}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300 font-medium">{fmtNum(s.totalTokens)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${totals.total > 0 ? Math.round(s.totalTokens / totals.total * 100) : 0}%`,
                            background: DEP_COLORS[deployments.indexOf(s.deployment) % DEP_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {totals.total > 0 ? Math.round(s.totalTokens / totals.total * 100) : 0}%
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(s.requests)}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">${s.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Users & Groups ──────────────────────────────────────────────────── */}
      {usersGroups && (
        <UsersGroupsSection data={usersGroups} summaries={summaries} costLimits={costLimits} policyData={policyData} />
      )}
    </div>
  )
}

function ChartCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 xl:p-5">
      <div className="flex items-center gap-1.5 mb-3 xl:mb-4">
        {icon && <span className="text-gray-400">{icon}</span>}
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</span>
      </div>
      {children}
    </div>
  )
}

function ModelDonutCard({ summaries }: { summaries: DepSummary[] }) {
  const total = summaries.reduce((s, d) => s + d.totalTokens, 0)
  const data = summaries.map((s, i) => ({
    name: s.deployment,
    value: s.totalTokens,
    color: DEP_COLORS[i % DEP_COLORS.length],
    pct: total > 0 ? (s.totalTokens / total * 100).toFixed(1) : '0',
  }))
  return (
    <ChartCard title="Top Models by Total Tokens">
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius="45%" outerRadius="70%"
              dataKey="value" nameKey="name"
              label={({ name, pct }) => `${name}\n${pct}%`} labelLine={true}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v: number) => fmtNum(v)} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={CHART_TEXT} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function CostPerModelCard({ summaries }: { summaries: DepSummary[] }) {
  const data = [...summaries].sort((a, b) => b.cost - a.cost).map(s => ({
    name: s.deployment,
    cost: s.cost,
  }))
  return (
    <ChartCard title="Estimated Cost per Model">
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" tickFormatter={v => `$${v.toFixed(2)}`} tick={{ fontSize: 9 }} label={{ value: 'Est. Cost (USD)', position: 'insideBottom', offset: -2, fontSize: 9, fill: '#9ca3af' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
            <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="cost" fill="#3b82f6" radius={[0, 3, 3, 0]}
              label={{ position: 'right', formatter: (v: number) => v > 0 ? `$${v.toFixed(4)}` : '$0', fontSize: 9, fill: '#6b7280' }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function PromptVsCompletionCard({ summaries }: { summaries: DepSummary[] }) {
  const data = summaries.map(s => ({ name: s.deployment, Prompt: s.inputTokens, Completion: s.outputTokens }))
  return (
    <ChartCard title="Prompt vs Completion Tokens per Model">
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} label={{ value: 'Model', position: 'insideBottom', offset: -2, fontSize: 9, fill: '#9ca3af' }} />
            <YAxis tickFormatter={fmtNum} tick={{ fontSize: 10 }} label={{ value: 'Tokens', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#9ca3af' }} />
            <Tooltip formatter={(v: number) => fmtNum(v)} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={CHART_TEXT} />
            <Bar dataKey="Prompt" fill="#3b82f6" />
            <Bar dataKey="Completion" fill="#8b5cf6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function GroupBadge({ group }: { group: string }) {
  const color = GROUP_COLORS[group] ?? '#6b7280'
  const label = group.charAt(0).toUpperCase() + group.slice(1)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  )
}

function UsersGroupsSection({
  data, summaries, costLimits, policyData,
}: {
  data: UsersGroupsData
  summaries: DepSummary[]
  costLimits: CostLimits | undefined
  policyData: { limits: Record<string, number>; groupLimits: Record<string, number>; userLimits: Record<string, number>; defaultTpm: number } | undefined
}) {
  const { users, groups } = data
  const [showAllGroups, setShowAllGroups] = useState(false)
  const [showAllUsers, setShowAllUsers] = useState(false)
  const ROW_CAP = 10

  const totalRequests = users.reduce((s, u) => s + u.total, 0)
  const totalBlocked  = users.reduce((s, u) => s + u.blocked, 0)
  const activeUsers   = users.filter(u => u.total > 0).length
  const mostActive    = users.reduce((best, u) => (u.total > (best?.total ?? -1) ? u : best), users[0])

  const userBarData = users.map(u => ({ name: u.display, success: u.success, blocked: u.blocked, group: u.group }))
  const groupPieData = groups.map(g => ({ name: g.display, value: g.total, groupId: g.groupId }))

  const depNames = [...new Set(data.userModelStats.map(s => s.deployment))].sort()
  const userModelChartData = users.map(u => {
    const entry: Record<string, number | string> = { user: u.display }
    depNames.forEach(dep => {
      const s = data.userModelStats.find(x => x.apimSub === u.apimSub && x.deployment === dep)
      entry[dep] = s?.calls ?? 0
    })
    return entry
  })

  const avgTokPerCall = Object.fromEntries(
    summaries.map(s => [s.deployment, s.requests > 0 ? s.totalTokens / s.requests : 0])
  )

  // Avg cost per request across all deployments (fallback when per-model stats unavailable)
  const totalCost = summaries.reduce((s, d) => s + d.cost, 0)
  const totalReqs = summaries.reduce((s, d) => s + d.requests, 0)
  const avgCostPerReq = totalReqs > 0 ? totalCost / totalReqs : 0

  const hasModelStats = data.userModelStats.length > 0

  const userEstCost = Object.fromEntries(
    users.map(u => [
      u.apimSub,
      hasModelStats
        ? data.userModelStats
            .filter(s => s.apimSub === u.apimSub)
            .reduce((sum, s) => sum + getCostBlended(s.deployment, s.calls * (avgTokPerCall[s.deployment] ?? 0)), 0)
        : u.success * avgCostPerReq,
    ])
  )
  const groupEstCost = Object.fromEntries(
    groups.map(g => [
      g.groupId,
      users.filter(u => u.group === g.groupId).reduce((s, u) => s + (userEstCost[u.apimSub] ?? 0), 0),
    ])
  )

  const totalUserCost = Object.values(userEstCost).reduce((s, v) => s + v, 0)
  const totalGroupCost = Object.values(groupEstCost).reduce((s, v) => s + v, 0)

  const visibleGroups = showAllGroups ? groups : groups.slice(0, ROW_CAP)
  const visibleUsers  = showAllUsers  ? users  : users.slice(0, ROW_CAP)

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white pt-2">Users &amp; Groups</h3>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 xl:gap-4">
        {[
          { label: 'Active Users',     value: String(activeUsers) },
          { label: 'Total Requests',   value: fmtNum(totalRequests) },
          { label: 'Most Active',      value: mostActive?.display ?? '—' },
          { label: 'Blocked Requests', value: fmtNum(totalBlocked) },
          { label: 'Est. User Cost',   value: totalUserCost > 0 ? `$${totalUserCost.toFixed(2)}` : '—', sub: 'all users combined' },
          { label: 'Est. Group Cost',  value: totalGroupCost > 0 ? `$${totalGroupCost.toFixed(2)}` : '—', sub: 'all groups combined' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</div>
            <div className="text-xl font-bold text-gray-900 dark:text-white truncate">{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 xl:gap-4">
        <div className="lg:col-span-2">
          <ChartCard title="Requests per User">
            <div className="h-[220px] md:h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={userBarData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <defs>
                    <linearGradient id="gradUserBlue" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.4}/>
                    </linearGradient>
                    <linearGradient id="gradUserPurple" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%"   stopColor="#8b5cf6" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                    </linearGradient>
                    <linearGradient id="gradUserBlocked" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickFormatter={fmtNum} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip formatter={(v: number) => fmtNum(v)} contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={CHART_TEXT} />
                  <Bar dataKey="success" name="Success" stackId="a" radius={[0, 4, 4, 0]}>
                    {userBarData.map((entry, i) => {
                      const gradId = entry.group === 'manga' ? 'url(#gradUserPurple)' : 'url(#gradUserBlue)'
                      return <Cell key={i} fill={gradId} />
                    })}
                  </Bar>
                  <Bar dataKey="blocked" name="Blocked" stackId="a" fill="url(#gradUserBlocked)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
        <ChartCard title="Requests by Group">
          <div className="h-[220px] md:h-[260px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="80%">
              <PieChart>
                <Pie data={groupPieData} cx="50%" cy="50%" innerRadius="50%" outerRadius="80%"
                  dataKey="value" nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {groupPieData.map((entry, i) => <Cell key={i} fill={GROUP_COLORS[entry.groupId] ?? COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtNum(v)} contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Cost per User & Cost per Group charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
        <ChartCard title="Est. Cost per User (USD)">
          <div className="h-[220px] md:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={users.map(u => ({ name: u.display, cost: userEstCost[u.apimSub] ?? 0, group: u.group })).sort((a, b) => b.cost - a.cost)}
                layout="vertical" margin={{ left: 0, right: 52 }}
              >
                <defs>
                  <linearGradient id="gradCostUser" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="#10b981" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.7}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={v => `$${v.toFixed(2)}`} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, 'Est. Cost']} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="cost" fill="url(#gradCostUser)" radius={[0, 4, 4, 0]} maxBarSize={28}
                  label={{ position: 'right', formatter: (v: number) => v > 0 ? `$${v.toFixed(3)}` : '', fontSize: 9, fill: '#9ca3af' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Est. Cost per Group (USD)">
          <div className="h-[220px] md:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={groups.map(g => ({ name: g.display, cost: groupEstCost[g.groupId] ?? 0, groupId: g.groupId })).sort((a, b) => b.cost - a.cost)}
                layout="vertical" margin={{ left: 0, right: 52 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={v => `$${v.toFixed(2)}`} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, 'Est. Cost']} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={28}
                  label={{ position: 'right', formatter: (v: number) => v > 0 ? `$${v.toFixed(3)}` : '', fontSize: 9, fill: '#9ca3af' }}>
                  {groups.map((g, i) => <Cell key={i} fill={GROUP_COLORS[g.groupId] ?? COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Per-model call chart */}
      {hasModelStats && depNames.length > 0 && (
        <ChartCard title="Calls per User per Model">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userModelChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="user" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={fmtNum} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmtNum(v)} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={CHART_TEXT} />
                {depNames.map((dep, i) => (
                  <Bar key={dep} dataKey={dep} fill={DEP_COLORS[i % DEP_COLORS.length]} name={dep} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* ── Group Breakdown ── (shown FIRST) */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 font-medium text-sm text-gray-900 dark:text-white">Group Breakdown</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {['Group', 'Members', 'Requests', 'Blocked', 'Success Rate', 'Est. Cost', 'Monthly Budget', 'TPM Quota', 'Cost/Member'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {visibleGroups.map(g => {
                const rate      = g.total > 0 ? ((g.success / g.total) * 100).toFixed(1) : '—'
                const cost      = groupEstCost[g.groupId] ?? 0
                const costLimit = costLimits?.groups[g.groupId]
                const tpmLimit  = policyData?.groupLimits[g.groupId] ?? policyData?.defaultTpm
                const memberCount = users.filter(u => u.group === g.groupId).length
                const costPct   = costLimit && cost > 0 ? Math.min((cost / costLimit) * 100, 100) : null
                return (
                  <tr key={g.groupId} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-3"><GroupBadge group={g.groupId} /></td>
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{g.members.join(', ')}</td>
                    <td className="px-5 py-3 text-gray-700 dark:text-gray-300 font-medium">{fmtNum(g.total)}</td>
                    <td className="px-5 py-3">{g.blocked > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{fmtNum(g.blocked)}</span> : <span className="text-gray-400">0</span>}</td>
                    <td className="px-5 py-3">{rate !== '—' ? <span className={parseFloat(rate) >= 80 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>{rate}%</span> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{cost > 0 ? `$${cost.toFixed(3)}` : <span className="text-gray-400">—</span>}</td>
                    <td className="px-5 py-3">
                      {costLimit != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div className={`h-full rounded-full ${(costPct ?? 0) > 90 ? 'bg-red-500' : (costPct ?? 0) > 70 ? 'bg-amber-400' : 'bg-green-500'}`} style={{ width: `${costPct ?? 0}%` }} />
                          </div>
                          <span className="text-xs text-gray-400">${costLimit}/mo</span>
                        </div>
                      ) : <span className="text-xs text-gray-300 dark:text-gray-600">no limit</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{tpmLimit != null ? `${fmtNum(tpmLimit)} TPM` : '—'}</td>
                    <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{cost > 0 && memberCount > 0 ? `$${(cost / memberCount).toFixed(3)}` : <span className="text-gray-400">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {groups.length > ROW_CAP && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800">
            <button onClick={() => setShowAllGroups(v => !v)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">
              {showAllGroups ? 'Show less' : `Show all ${groups.length} groups`}
            </button>
          </div>
        )}
      </div>

      {/* ── User Breakdown ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 font-medium text-sm text-gray-900 dark:text-white">User Breakdown</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {['User', 'Group', 'Requests', 'Blocked', 'Success Rate', 'Est. Cost', 'Monthly Budget', 'TPM Quota'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {visibleUsers.map(u => {
                const rate      = u.total > 0 ? ((u.success / u.total) * 100).toFixed(1) : '—'
                const cost      = userEstCost[u.apimSub] ?? 0
                const costLimit = costLimits?.users[u.apimSub]
                const tpmLimit  = policyData?.userLimits[u.apimSub] ?? policyData?.groupLimits[u.group] ?? policyData?.defaultTpm
                const costPct   = costLimit && cost > 0 ? Math.min((cost / costLimit) * 100, 100) : null
                return (
                  <tr key={u.apimSub} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{u.display}</td>
                    <td className="px-5 py-3"><GroupBadge group={u.group} /></td>
                    <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(u.total)}</td>
                    <td className="px-5 py-3">{u.blocked > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{fmtNum(u.blocked)}</span> : <span className="text-gray-400">0</span>}</td>
                    <td className="px-5 py-3">{rate !== '—' ? <span className={parseFloat(rate) >= 80 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>{rate}%</span> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{cost > 0 ? `$${cost.toFixed(3)}` : <span className="text-gray-400">—</span>}</td>
                    <td className="px-5 py-3">
                      {costLimit != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div className={`h-full rounded-full ${(costPct ?? 0) > 90 ? 'bg-red-500' : (costPct ?? 0) > 70 ? 'bg-amber-400' : 'bg-green-500'}`} style={{ width: `${costPct ?? 0}%` }} />
                          </div>
                          <span className="text-xs text-gray-400">${costLimit}/mo</span>
                        </div>
                      ) : <span className="text-xs text-gray-300 dark:text-gray-600">no limit</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{tpmLimit != null ? `${fmtNum(tpmLimit)} TPM` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {users.length > ROW_CAP && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800">
            <button onClick={() => setShowAllUsers(v => !v)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">
              {showAllUsers ? 'Show less' : `Show all ${users.length} users`}
            </button>
          </div>
        )}
      </div>

      {/* Per-user model detail table */}
      {hasModelStats && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 font-medium text-sm text-gray-900 dark:text-white">Per-User Model Usage</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  {['User', 'Group', 'Deployment', 'Calls', 'Blocked', 'Est. Tokens', 'Est. Cost'].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users.flatMap(u =>
                  data.userModelStats
                    .filter(s => s.apimSub === u.apimSub && s.calls > 0)
                    .sort((a, b) => b.calls - a.calls)
                    .map(s => {
                      const estTok  = Math.round(s.calls * (avgTokPerCall[s.deployment] ?? 0))
                      const estCost = getCostBlended(s.deployment, estTok)
                      return (
                        <tr key={`${u.apimSub}-${s.deployment}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                          <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{u.display}</td>
                          <td className="px-5 py-3"><GroupBadge group={u.group} /></td>
                          <td className="px-5 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{s.deployment}</td>
                          <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{fmtNum(s.calls)}</td>
                          <td className="px-5 py-3">{s.blocked > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{s.blocked}</span> : <span className="text-gray-400">0</span>}</td>
                          <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{estTok > 0 ? fmtNum(estTok) : <span className="text-gray-400">—</span>}</td>
                          <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{estCost > 0 ? `$${estCost.toFixed(4)}` : <span className="text-gray-400">—</span>}</td>
                        </tr>
                      )
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
