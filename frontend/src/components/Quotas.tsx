import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import { useApiClient } from '../api/client'

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtNum(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString()
}

/** TPM values from ARM are in units of 1K tokens/min — display with "K" */
function fmtTpm(n: number) {
  if (n >= 1000) return fmtNum(n * 1000)   // e.g. 1000 → "1.0M"
  return `${n}K`
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#f43f5e']

const TOOLTIP_STYLE: React.CSSProperties = {
  fontSize: 11, borderRadius: 8,
  border: '1px solid var(--tooltip-border)',
  background: 'var(--tooltip-bg)',
  color: 'var(--tooltip-text)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
}

// ── Types ────────────────────────────────────────────────────────────────────
interface QuotaRow {
  resource: string
  rg: string
  subId: string
  subName: string
  location: string
  kind: string
  deployment: string
  model: string
  modelVersion: string
  modelFormat: string
  skuName: string
  skuTier: string
  tpm: number
  rpm: number
  provisioningState: string
  versionUpgrade: string
}

type GroupBy = 'resource' | 'model' | 'region' | 'subscription'

export default function Quotas() {
  const { get } = useApiClient()
  const [groupBy, setGroupBy] = useState<GroupBy>('resource')
  const [search, setSearch] = useState('')

  type SortKey = 'deployment' | 'model' | 'modelVersion' | 'skuName' | 'tpm' | 'rpm' | 'location' | 'resource' | 'subName' | 'provisioningState'
  type TableGroup = 'none' | 'model' | 'region' | 'resource' | 'subscription' | 'sku'
  const [sortCol, setSortCol] = useState<SortKey>('resource')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [tableGroup, setTableGroup] = useState<TableGroup>('none')

  const toggleSort = (col: SortKey) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const { data: rows = [], isFetching } = useQuery<QuotaRow[]>({
    queryKey: ['quotas'],
    queryFn: () => get('/api/quotas'),
  })

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return rows
    const s = search.toLowerCase()
    return rows.filter(r =>
      r.deployment.toLowerCase().includes(s) ||
      r.model.toLowerCase().includes(s) ||
      r.resource.toLowerCase().includes(s) ||
      r.location.toLowerCase().includes(s) ||
      r.subName.toLowerCase().includes(s)
    )
  }, [rows, search])

  // Aggregate by chosen dimension
  const aggregated = useMemo(() => {
    const map = new Map<string, { label: string; tpm: number; rpm: number; deployments: number }>()
    filtered.forEach(r => {
      let key = ''
      let label = ''
      switch (groupBy) {
        case 'resource':
          key = `${r.subId}/${r.resource}`
          label = r.resource
          break
        case 'model':
          key = r.model || '(unknown)'
          label = key
          break
        case 'region':
          key = r.location || '(unknown)'
          label = key
          break
        case 'subscription':
          key = r.subId
          label = r.subName
          break
      }
      const e = map.get(key)
      if (e) {
        e.tpm += r.tpm
        e.rpm += r.rpm
        e.deployments += 1
      } else {
        map.set(key, { label, tpm: r.tpm, rpm: r.rpm, deployments: 1 })
      }
    })
    return [...map.values()].sort((a, b) => b.tpm - a.tpm)
  }, [filtered, groupBy])

  // Totals
  const totalTpm = filtered.reduce((s, r) => s + r.tpm, 0)
  const totalRpm = filtered.reduce((s, r) => s + r.rpm, 0)
  const totalDeployments = filtered.length
  const uniqueModels = new Set(filtered.map(r => r.model)).size
  const uniqueRegions = new Set(filtered.map(r => r.location)).size
  const uniqueResources = new Set(filtered.map(r => `${r.subId}/${r.resource}`)).size

  // Per-model aggregation for pie chart
  const modelAgg = useMemo(() => {
    const map = new Map<string, number>()
    filtered.forEach(r => {
      const m = r.model || '(unknown)'
      map.set(m, (map.get(m) ?? 0) + r.tpm)
    })
    return [...map.entries()]
      .map(([name, tpm]) => ({ name, tpm }))
      .sort((a, b) => b.tpm - a.tpm)
  }, [filtered])

  // Per-region aggregation for bar chart
  const regionAgg = useMemo(() => {
    const map = new Map<string, { tpm: number; rpm: number; deployments: number }>()
    filtered.forEach(r => {
      const loc = r.location || '(unknown)'
      const e = map.get(loc)
      if (e) { e.tpm += r.tpm; e.rpm += r.rpm; e.deployments += 1 }
      else map.set(loc, { tpm: r.tpm, rpm: r.rpm, deployments: 1 })
    })
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.tpm - a.tpm)
  }, [filtered])

  const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
    { value: 'resource', label: 'By Resource' },
    { value: 'model', label: 'By Model' },
    { value: 'region', label: 'By Region' },
    { value: 'subscription', label: 'By Subscription' },
  ]

  // Sort filtered rows for table
  const sortedRows = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortCol === 'tpm' || sortCol === 'rpm') {
        av = a[sortCol]; bv = b[sortCol]
      } else {
        av = (a[sortCol] ?? '').toLowerCase()
        bv = (b[sortCol] ?? '').toLowerCase()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [filtered, sortCol, sortDir])

  // Group sorted rows for table rendering
  const groupedRows = useMemo(() => {
    if (tableGroup === 'none') return [{ label: '', rows: sortedRows }]
    const map = new Map<string, QuotaRow[]>()
    sortedRows.forEach(r => {
      let key = ''
      switch (tableGroup) {
        case 'model': key = r.model || '(unknown)'; break
        case 'region': key = r.location || '(unknown)'; break
        case 'resource': key = r.resource; break
        case 'subscription': key = r.subName; break
        case 'sku': key = r.skuName || '(unknown)'; break
      }
      const existing = map.get(key)
      if (existing) existing.push(r)
      else map.set(key, [r])
    })
    return [...map.entries()].map(([label, rows]) => ({ label, rows }))
  }, [sortedRows, tableGroup])

  const TABLE_GROUP_OPTIONS: { value: TableGroup; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'model', label: 'Model' },
    { value: 'region', label: 'Region' },
    { value: 'resource', label: 'Resource' },
    { value: 'subscription', label: 'Subscription' },
    { value: 'sku', label: 'SKU' },
  ]

  const TABLE_COLS: { key: SortKey; label: string; align?: 'right' }[] = [
    { key: 'deployment', label: 'Deployment' },
    { key: 'model', label: 'Model' },
    { key: 'modelVersion', label: 'Version' },
    { key: 'skuName', label: 'SKU' },
    { key: 'tpm', label: 'TPM', align: 'right' },
    { key: 'rpm', label: 'RPM', align: 'right' },
    { key: 'location', label: 'Region' },
    { key: 'resource', label: 'Resource' },
    { key: 'subName', label: 'Subscription' },
    { key: 'provisioningState', label: 'State' },
  ]

  function quotaRequestUrl(r: QuotaRow) {
    return `https://portal.azure.com/#view/Microsoft_Azure_Capacity/QuotaMenuBlade/~/myQuotas/provider/Microsoft.CognitiveServices/location/${encodeURIComponent(r.location)}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Provisioned Quotas</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            TPM &amp; RPM quotas for every deployment across all subscriptions and resources
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search deployments, models, regions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none w-56"
          />
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            {GROUP_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setGroupBy(o.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  groupBy === o.value
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 bg-white dark:bg-gray-900'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {isFetching && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 xl:gap-4">
        {[
          { label: 'Total TPM', value: fmtNum(totalTpm), sub: 'tokens / min' },
          { label: 'Total RPM', value: fmtNum(totalRpm), sub: 'requests / min' },
          { label: 'Deployments', value: String(totalDeployments), sub: 'across all resources' },
          { label: 'Models', value: String(uniqueModels), sub: 'unique models' },
          { label: 'Regions', value: String(uniqueRegions), sub: 'Azure regions' },
          { label: 'Resources', value: String(uniqueResources), sub: 'Foundry / AI Services' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 xl:p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</div>
            <div className="text-2xl xl:text-3xl font-bold text-gray-900 dark:text-white">{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:gap-4">
        {/* Aggregated bar chart */}
        <ChartCard title={`TPM ${GROUP_OPTIONS.find(o => o.value === groupBy)?.label ?? ''}`}>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={aggregated.slice(0, 12).map(a => ({ name: a.label, tpm: a.tpm, rpm: a.rpm }))}
                layout="vertical" margin={{ left: 8, right: 60 }}
              >
                <defs>
                  <linearGradient id="gradTpm" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.7}/>
                  </linearGradient>
                  <linearGradient id="gradRpm" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0.7}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={v => fmtNum(v)} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                <Tooltip formatter={(v: number, name: string) => [fmtNum(v), name === 'tpm' ? 'TPM' : 'RPM']} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--chart-text)' }} />
                <Bar dataKey="tpm" name="TPM" fill="url(#gradTpm)" radius={[0, 4, 4, 0]} maxBarSize={22}
                  label={{ position: 'right', formatter: (v: number) => v > 0 ? fmtNum(v) : '', fontSize: 9, fill: '#9ca3af' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Model distribution pie */}
        <ChartCard title="TPM Distribution by Model">
          <div className="h-[280px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="90%">
              <PieChart>
                <Pie
                  data={modelAgg.slice(0, 10)}
                  cx="50%" cy="50%" innerRadius="40%" outerRadius="72%"
                  dataKey="tpm" nameKey="name"
                  label={({ name, percent }) => `${name.length > 20 ? name.slice(0, 20) + '…' : name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {modelAgg.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtNum(v)} contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Region bar chart */}
      <ChartCard title="Provisioned TPM by Region">
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={regionAgg} margin={{ left: 0, right: 24, top: 8 }}>
              <defs>
                <linearGradient id="gradRegTpm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9}/>
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0.6}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => fmtNum(v)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number, name: string) => [fmtNum(v), name === 'tpm' ? 'TPM' : 'Deployments']} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--chart-text)' }} />
              <Bar dataKey="tpm" name="TPM" fill="url(#gradRegTpm)" radius={[4, 4, 0, 0]} maxBarSize={40}
                label={{ position: 'top', formatter: (v: number) => v > 0 ? fmtNum(v) : '', fontSize: 9, fill: '#9ca3af' }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Full deployment table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span className="font-medium text-sm text-gray-900 dark:text-white">
            All Deployments ({filtered.length})
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Group by:</span>
            <select
              value={tableGroup}
              onChange={e => setTableGroup(e.target.value as TableGroup)}
              className="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {TABLE_GROUP_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {TABLE_COLS.map(c => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {c.label}
                      {sortCol === c.key ? (
                        sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                      ) : (
                        <span className="w-3" />
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {groupedRows.map(group => (
                <>
                  {group.label && (
                    <tr key={`grp-${group.label}`} className="bg-gray-50/70 dark:bg-gray-800/30">
                      <td colSpan={11} className="px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                        {group.label}
                        <span className="ml-2 font-normal text-gray-400">({group.rows.length})</span>
                      </td>
                    </tr>
                  )}
                  {group.rows.map(r => (
                    <tr key={`${r.subId}/${r.resource}/${r.deployment}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900 dark:text-white whitespace-nowrap">{r.deployment}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.model}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.modelVersion || '—'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          r.skuName === 'GlobalStandard' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' :
                          r.skuName === 'Standard' ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
                          r.skuName === 'GlobalProvisioned' ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' :
                          r.skuName === 'ProvisionedManaged' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
                          'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}>
                          {r.skuName}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-gray-900 dark:text-white text-right tabular-nums">{fmtTpm(r.tpm)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 text-right tabular-nums">{r.rpm > 0 ? fmtNum(r.rpm) : '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.location}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.resource}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap max-w-[200px] truncate" title={r.subName}>{r.subName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                          r.provisioningState === 'Succeeded' ? 'bg-green-500' :
                          r.provisioningState === 'Failed' ? 'bg-red-500' : 'bg-yellow-500'
                        }`} />
                        <span className="text-xs text-gray-600 dark:text-gray-400">{r.provisioningState}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <a
                          href={quotaRequestUrl(r)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Request quota increase"
                          className="inline-flex items-center text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-400">
                    {isFetching ? 'Loading quotas…' : 'No deployments found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
