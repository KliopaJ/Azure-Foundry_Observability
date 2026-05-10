import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2, ChevronDown, ChevronUp, RefreshCw, ExternalLink } from 'lucide-react'
import { useApiClient } from '../api/client'
import { useApp } from '../context/AppContext'
import { PolicyResponse, DeploymentInfo, CostLimits, DepLimitConfig } from '../types'
import { ModelPricing, MODEL_PRICING, MODEL_PRICING_DEFAULT, PRICING_SOURCES, detectModelPricing, blendedPer1K } from '../pricing'

// ── Static user / group registry (mirrored from backend) ─────────────────────
const USERS = [
  { apimSub: 'peter-parker',   display: 'Peter Parker',    group: 'superheroes' },
  { apimSub: 'tonny-stark',    display: 'Tonny Stark',     group: 'superheroes' },
  { apimSub: 'son-goku',       display: 'Son Goku',        group: 'manga' },
  { apimSub: 'monkey-d-luffy', display: 'Monkey D. Luffy', group: 'manga' },
]
const GROUPS = [
  { id: 'superheroes', display: 'Superheroes', color: '#3b82f6' },
  { id: 'manga',       display: 'Manga',       color: '#8b5cf6' },
]

// ── Azure pricing source: see pricing.ts for full table ──────────────────────

function detectModelRate(dep: string): { key: string; rate: number } {
  const { key, pricing } = detectModelPricing(dep)
  return { key, rate: blendedPer1K(pricing) }
}

function fmtTokShort(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(Math.round(n))
}

/** Shows monthly token equivalents per deployment for a given dollar budget, broken down by request type. */
function TokenEquivHint({ budgetStr, depNames }: { budgetStr: string; depNames: string[] }) {
  const val = parseFloat(budgetStr)
  if (!val || isNaN(val) || depNames.length === 0) return null
  return (
    <div className="mt-1.5 space-y-1">
      {depNames.map(dep => {
        const { key, pricing } = detectModelPricing(dep)
        const inTok  = Math.round(val * 1_000_000 / pricing.input)
        const outTok = Math.round(val * 1_000_000 / pricing.output)
        return (
          <div key={dep} className="flex flex-wrap items-center gap-1 text-[10px] text-gray-400">
            <span className="font-mono truncate" style={{ maxWidth: 88 }}>{dep}</span>
            <span className="text-gray-300 dark:text-gray-600">→</span>
            <span className="text-green-600 dark:text-green-400 font-semibold">In {fmtTokShort(inTok)}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold">Out {fmtTokShort(outTok)}</span>
            <span className="text-gray-300 dark:text-gray-600 italic">({key} · ${pricing.input}/${pricing.output} /1M)</span>
          </div>
        )
      })}
    </div>
  )
}

function GroupBadge({ groupId }: { groupId: string }) {
  const g = GROUPS.find(x => x.id === groupId)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
      style={{ backgroundColor: g?.color ?? '#6b7280' }}
    >
      {g?.display ?? groupId}
    </span>
  )
}

/** Pretty-print single-line XML into indented, multi-line form. */
function formatXml(xml: string): string {
  let formatted = ''
  let indent = 0
  // Split on tag boundaries
  const parts = xml.replace(/>\s*</g, '><').split(/(<[^>]+>)/g).filter(Boolean)
  for (const part of parts) {
    if (part.startsWith('</')) {
      indent = Math.max(0, indent - 1)
      formatted += '  '.repeat(indent) + part + '\n'
    } else if (part.startsWith('<') && part.endsWith('/>')) {
      formatted += '  '.repeat(indent) + part + '\n'
    } else if (part.startsWith('<') && !part.startsWith('<!--')) {
      formatted += '  '.repeat(indent) + part + '\n'
      indent++
    } else {
      // text content or comment
      const trimmed = part.trim()
      if (trimmed) formatted += '  '.repeat(indent) + trimmed + '\n'
    }
  }
  return formatted.trimEnd()
}

/** Code viewer with VS Code–style line numbers. */
function XmlCodeView({ xml }: { xml: string }) {
  const formatted = formatXml(xml)
  const lines = formatted.split('\n')
  const gutterWidth = String(lines.length).length
  return (
    <div className="overflow-x-auto bg-gray-50 dark:bg-gray-800/50 font-mono text-xs leading-5">
      <table className="border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-gray-100 dark:hover:bg-gray-700/30">
              <td className="select-none text-right pr-3 pl-4 text-gray-400 dark:text-gray-600 border-r border-gray-200 dark:border-gray-700 align-top"
                  style={{ minWidth: `${gutterWidth + 2}ch` }}>
                {i + 1}
              </td>
              <td className="pl-4 pr-5 whitespace-pre text-gray-700 dark:text-gray-300">{line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Settings() {
  const { get, put, remove } = useApiClient()
  const { subId, rg, foundryName, config } = useApp()
  const qc = useQueryClient()

  const { data: deploymentInfos = [], isFetching: depsFetching, refetch: refetchDeps } = useQuery<DeploymentInfo[]>({
    queryKey: ['deployments', subId, rg, foundryName],
    queryFn: () => get('/api/deployments', { sub_id: subId, rg, foundry: foundryName }),
    enabled: !!subId && !!rg && !!foundryName,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
  const deployments = deploymentInfos.map(d => d.name)

  const { data: policy } = useQuery<PolicyResponse>({
    queryKey: ['policy', config.apimSubId, config.apimRg, config.apimName],
    queryFn: () => get('/api/policy', { sub_id: config.apimSubId, rg: config.apimRg, apim: config.apimName, api_id: config.apimApiId }),
    enabled: !!config.apimSubId && !!config.apimRg && !!config.apimName,
  })

  const [depLimits,   setDepLimits]   = useState<Record<string, string>>({})
  const [userLimits,  setUserLimits]  = useState<Record<string, string>>({})
  const [groupLimits, setGroupLimits] = useState<Record<string, string>>({})
  const [defaultTpm,  setDefaultTpm]  = useState(String(config.defaultTpm))

  // Per-deployment limit type: 'tpm' | 'cost'
  const [depLimitTypes, setDepLimitTypes] = useState<Record<string, 'tpm' | 'cost'>>({})
  const [depCostValues, setDepCostValues] = useState<Record<string, string>>({})
  const depCfgInitialized = useRef(false)
  const [xmlOpen, setXmlOpen] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Per-group and per-user limit type switcher: 'tpm' | 'cost'
  const [groupLimitTypes, setGroupLimitTypes] = useState<Record<string, 'tpm' | 'cost'>>({})
  const [userLimitTypes,  setUserLimitTypes]  = useState<Record<string, 'tpm' | 'cost'>>({})

  // Cost limits
  const [editUserCost,     setEditUserCost]     = useState<Record<string, string>>({})
  const [editGroupCost,    setEditGroupCost]    = useState<Record<string, string>>({})
  const [costSaveSuccess,  setCostSaveSuccess]  = useState<string | null>(null)
  const [costSaveError,    setCostSaveError]    = useState<string | null>(null)

  const { data: costLimits } = useQuery<CostLimits>({
    queryKey: ['cost-limits'],
    queryFn: () => get('/api/cost-limits'),
  })

  const costLimitMutation = useMutation({
    mutationFn: () => {
      const users: Record<string, number>  = {}
      const groups: Record<string, number> = {}
      USERS.forEach(u => {
        const val = editUserCost[u.apimSub] ?? (costLimits?.users[u.apimSub] != null ? String(costLimits.users[u.apimSub]) : '')
        if (val !== '') users[u.apimSub] = parseFloat(val)
      })
      GROUPS.forEach(g => {
        const val = editGroupCost[g.id] ?? (costLimits?.groups[g.id] != null ? String(costLimits.groups[g.id]) : '')
        if (val !== '') groups[g.id] = parseFloat(val)
      })
      const body: Record<string, unknown> = { users, groups }
      const pb = editProjectBudget !== '' ? editProjectBudget : (costLimits?.projectBudget != null ? String(costLimits.projectBudget) : '')
      if (pb !== '') body.projectBudget = parseFloat(pb)
      return put('/api/cost-limits', {}, body)
    },
    onSuccess: () => {
      setCostSaveError(null)
      setCostSaveSuccess('Cost limits saved.')
      setTimeout(() => setCostSaveSuccess(null), 3000)
      qc.invalidateQueries({ queryKey: ['cost-limits'] })
    },
    onError: (e: Error) => { setCostSaveError(e.message); setCostSaveSuccess(null) },
  })

  // Project-level budget
  const [editProjectBudget, setEditProjectBudget] = useState('')

  // Initialize per-dep limit types from persisted cost_limits.json (one-time on load)
  useEffect(() => {
    if (depCfgInitialized.current || !costLimits?.depLimitConfigs) return
    depCfgInitialized.current = true
    const types: Record<string, 'tpm' | 'cost'> = {}
    const costs: Record<string, string> = {}
    Object.entries(costLimits.depLimitConfigs).forEach(([dep, cfg]: [string, DepLimitConfig]) => {
      types[dep] = cfg.type
      if (cfg.type === 'cost') costs[dep] = String(cfg.value)
    })
    setDepLimitTypes(types)
    setDepCostValues(costs)

    // Initialize group/user limit types: if a cost limit is set, default to 'cost' mode
    const gTypes: Record<string, 'tpm' | 'cost'> = {}
    GROUPS.forEach(g => { gTypes[g.id] = costLimits.groups[g.id] != null ? 'cost' : 'tpm' })
    setGroupLimitTypes(gTypes)

    const uTypes: Record<string, 'tpm' | 'cost'> = {}
    USERS.forEach(u => { uTypes[u.apimSub] = costLimits.users[u.apimSub] != null ? 'cost' : 'tpm' })
    setUserLimitTypes(uTypes)
  }, [costLimits])

  const effectiveDepLimits = deployments.reduce<Record<string, string>>((acc, dep) => {
    acc[dep] = depLimits[dep] ?? String(policy?.limits?.[dep] ?? config.defaultTpm)
    return acc
  }, {})

  const effectiveUserLimits = USERS.reduce<Record<string, string>>((acc, u) => {
    acc[u.apimSub] = userLimits[u.apimSub] ?? String(policy?.userLimits?.[u.apimSub] ?? config.defaultTpm)
    return acc
  }, {})

  const effectiveGroupLimits = GROUPS.reduce<Record<string, string>>((acc, g) => {
    acc[g.id] = groupLimits[g.id] ?? String(policy?.groupLimits?.[g.id] ?? config.defaultTpm)
    return acc
  }, {})

  const applyMutation = useMutation<PolicyResponse, Error>({
    mutationFn: () => {
      // Only send TPM limits for TPM-mode deps (cost-mode TPM is computed backend-side)
      const tpmOnlyLimits = Object.fromEntries(
        deployments
          .filter(d => (depLimitTypes[d] ?? 'tpm') === 'tpm')
          .map(d => [d, parseInt(effectiveDepLimits[d], 10)])
      )
      // Cost mode: collect budget + blended price per dep (computed from per-type pricing table)
      const depCostLimitsOut = Object.fromEntries(
        deployments
          .filter(d => depLimitTypes[d] === 'cost')
          .map(d => {
            const liveCfg = costLimits?.depLimitConfigs?.[d]
            const val = depCostValues[d] ?? (liveCfg?.type === 'cost' ? String(liveCfg.value) : '0')
            return [d, parseFloat(val || '0')]
          })
      )
      const depPriceOut = Object.fromEntries(
        deployments
          .filter(d => depLimitTypes[d] === 'cost')
          .map(d => [d, blendedPer1K(detectModelPricing(d).pricing)])
      )

      // Average blended price across all deployments (for user/group cost→TPM conversion)
      const avgPrice = deployments.length > 0
        ? deployments.reduce((s, d) => s + blendedPer1K(detectModelPricing(d).pricing), 0) / deployments.length
        : 0.001

      // User cost mode: collect budgets for cost-mode users
      const userCostLimitsOut = Object.fromEntries(
        USERS
          .filter(u => userLimitTypes[u.apimSub] === 'cost')
          .map(u => {
            const val = editUserCost[u.apimSub] ?? (costLimits?.users[u.apimSub] != null ? String(costLimits.users[u.apimSub]) : '0')
            return [u.apimSub, parseFloat(val || '0')]
          })
      )
      // Group cost mode: collect budgets for cost-mode groups
      const groupCostLimitsOut = Object.fromEntries(
        GROUPS
          .filter(g => groupLimitTypes[g.id] === 'cost')
          .map(g => {
            const val = editGroupCost[g.id] ?? (costLimits?.groups[g.id] != null ? String(costLimits.groups[g.id]) : '0')
            return [g.id, parseFloat(val || '0')]
          })
      )

      return put<PolicyResponse>('/api/policy', { sub_id: config.apimSubId, rg: config.apimRg, apim: config.apimName, api_id: config.apimApiId }, {
        deployments,
        limits: tpmOnlyLimits,
        depLimitTypes: Object.fromEntries(deployments.map(d => [d, depLimitTypes[d] ?? 'tpm'])),
        depCostLimits: depCostLimitsOut,
        depPricePerKTokens: depPriceOut,
        userLimits:  Object.fromEntries(
          Object.entries(effectiveUserLimits).map(([k, v]) => [k, parseInt(v, 10)])
        ),
        groupLimits: Object.fromEntries(
          Object.entries(effectiveGroupLimits).map(([k, v]) => [k, parseInt(v, 10)])
        ),
        defaultTpm: parseInt(defaultTpm, 10),
        backendId: config.apimBackendId,
        userLimitTypes: Object.fromEntries(USERS.map(u => [u.apimSub, userLimitTypes[u.apimSub] ?? 'tpm'])),
        userCostLimits: userCostLimitsOut,
        groupLimitTypes: Object.fromEntries(GROUPS.map(g => [g.id, groupLimitTypes[g.id] ?? 'tpm'])),
        groupCostLimits: groupCostLimitsOut,
        avgPricePerKTokens: avgPrice,
      })
    },
    onSuccess: (data: PolicyResponse) => {
      setError(null)
      setSuccess('Policy applied successfully.')
      setTimeout(() => setSuccess(null), 4000)

      // Optimistically update the policy cache with the response
      // (avoids ARM GET caching returning stale data)
      qc.setQueryData(
        ['policy', config.apimSubId, config.apimRg, config.apimName],
        { xml: data.xml, limits: data.limits, userLimits: data.userLimits, groupLimits: data.groupLimits, defaultTpm: data.defaultTpm },
      )

      // Clear local edit state so UI reflects the fresh policy values
      setDepLimits({})
      setUserLimits({})
      setGroupLimits({})

      qc.invalidateQueries({ queryKey: ['cost-limits'] })
    },
    onError: (e: Error) => { setError(e.message); setSuccess(null) },
  })

  const resetMutation = useMutation({
    mutationFn: () => remove('/api/policy', { sub_id: config.apimSubId, rg: config.apimRg, apim: config.apimName, api_id: config.apimApiId }),
    onSuccess: () => {
      setError(null)
      setSuccess('Policy reset (all rate limits removed).')
      setTimeout(() => setSuccess(null), 4000)
      setDepLimits({})
      setUserLimits({})
      setGroupLimits({})
      setDefaultTpm(String(config.defaultTpm))
      qc.setQueryData(
        ['policy', config.apimSubId, config.apimRg, config.apimName],
        { xml: null, limits: {}, userLimits: {}, groupLimits: {}, defaultTpm: config.defaultTpm },
      )
    },
    onError: (e: Error) => { setError(e.message); setSuccess(null) },
  })

  if (!subId || !rg)
    return (
      <div className="text-center text-gray-400 dark:text-gray-600 mt-24 text-sm">
        Select a subscription and resource group first.
      </div>
    )

  // Pending changes helpers
  const pendingDeps = deployments.filter(dep => {
    const lt = depLimitTypes[dep] ?? 'tpm'
    if (lt === 'cost') {
      const liveCfg = costLimits?.depLimitConfigs?.[dep]
      if (liveCfg?.type !== 'cost') return true  // type changed
      const editedCost = depCostValues[dep]
      if (editedCost !== undefined && editedCost !== String(liveCfg.value)) return true
      return false
    }
    return String(effectiveDepLimits[dep]) !== String(policy?.limits?.[dep] ?? config.defaultTpm)
  })
  const pendingUsers = USERS.filter(
    u => String(effectiveUserLimits[u.apimSub]) !== String(policy?.userLimits?.[u.apimSub] ?? config.defaultTpm)
  )
  const pendingGroups = GROUPS.filter(
    g => String(effectiveGroupLimits[g.id]) !== String(policy?.groupLimits?.[g.id] ?? config.defaultTpm)
  )
  const pendingDefault = String(defaultTpm) !== String(policy?.defaultTpm ?? config.defaultTpm)
  const totalPending = pendingDeps.length + pendingUsers.length + pendingGroups.length + (pendingDefault ? 1 : 0)

  return (
    <div className="space-y-4 sm:space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">APIM Rate Limits &amp; Budgets</h2>

      {/* ── Row 1: Project quota + Global TPM ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* 1. Quota per month per project */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-5">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly Budget — Project</div>
          <p className="text-xs text-gray-400 mb-4">Global project-wide budget (informational, not APIM-enforced).</p>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Monthly Budget (USD)</label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">$</span>
              <input
                type="number" min="0" step="0.01" placeholder="no limit"
                value={editProjectBudget !== '' ? editProjectBudget : (costLimits?.projectBudget != null ? String(costLimits.projectBudget) : '')}
                onChange={e => setEditProjectBudget(e.target.value)}
                className="w-36 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-400">/mo</span>
            </div>
            <TokenEquivHint
              budgetStr={editProjectBudget !== '' ? editProjectBudget : (costLimits?.projectBudget != null ? String(costLimits.projectBudget) : '')}
              depNames={deployments}
            />
          </div>
        </div>

        {/* 4. Global Default TPM */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-5">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Global Default TPM</div>
          <p className="text-xs text-gray-400 mb-4">Applied when no specific user, group, or deployment limit matches.</p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <input
              type="number" min="0"
              value={defaultTpm}
              onChange={e => setDefaultTpm(e.target.value)}
              className="w-full sm:w-40 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-400">tokens / minute</span>
          </div>
        </div>
      </div>

      {/* ── Row 2: Per-Group limits (TPM / Monthly Budget) + Per-User limits (TPM / Monthly Budget) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Per-Group limits with switcher */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="text-sm font-medium text-gray-900 dark:text-white">Per-Group Limits</div>
            <p className="text-xs text-gray-400 mt-0.5">Set TPM rate limit (APIM-enforced) or monthly budget per group.</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {GROUPS.map(g => {
              const members = USERS.filter(u => u.group === g.id).map(u => u.display)
              const lt = groupLimitTypes[g.id] ?? 'tpm'
              const liveTpm = policy?.groupLimits?.[g.id]
              const localTpm = groupLimits[g.id]
              const tpmDirty = lt === 'tpm' && localTpm !== undefined && localTpm !== String(liveTpm ?? config.defaultTpm)
              const liveCost = costLimits?.groups[g.id]
              const localCost = editGroupCost[g.id]
              const costDirty = lt === 'cost' && localCost !== undefined && localCost !== String(liveCost ?? '')
              return (
                <div key={g.id} className="px-4 sm:px-5 py-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <GroupBadge groupId={g.id} />
                      <p className="text-[10px] text-gray-400 mt-0.5">{members.join(', ')}</p>
                    </div>
                    <select
                      value={lt}
                      onChange={e => setGroupLimitTypes(prev => ({ ...prev, [g.id]: e.target.value as 'tpm' | 'cost' }))}
                      className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="tpm">Rate limit (TPM)</option>
                      <option value="cost">Monthly budget ($)</option>
                    </select>
                  </div>
                  {lt === 'tpm' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min="0"
                        value={effectiveGroupLimits[g.id]}
                        onChange={e => setGroupLimits(prev => ({ ...prev, [g.id]: e.target.value }))}
                        className={`w-28 text-sm bg-white dark:bg-gray-800 border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${tpmDirty ? 'border-amber-400 dark:border-amber-500 text-amber-700 dark:text-amber-300' : 'border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white'}`}
                      />
                      <span className="text-xs text-gray-400">tokens / min</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">$</span>
                        <input
                          type="number" min="0" step="0.01" placeholder="no limit"
                          value={localCost ?? (liveCost != null ? String(liveCost) : '')}
                          onChange={e => setEditGroupCost(prev => ({ ...prev, [g.id]: e.target.value }))}
                          className={`w-24 text-sm bg-white dark:bg-gray-800 border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${costDirty ? 'border-amber-400 dark:border-amber-500 text-amber-700 dark:text-amber-300' : 'border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white'}`}
                        />
                        <span className="text-xs text-gray-400">/ mo</span>
                      </div>
                      <TokenEquivHint budgetStr={localCost ?? (liveCost != null ? String(liveCost) : '')} depNames={deployments} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Per-User limits with switcher */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="text-sm font-medium text-gray-900 dark:text-white">Per-User Limits</div>
            <p className="text-xs text-gray-400 mt-0.5">Set TPM rate limit (APIM-enforced) or monthly budget per user.</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {USERS.map(u => {
              const lt = userLimitTypes[u.apimSub] ?? 'tpm'
              const liveTpm = policy?.userLimits?.[u.apimSub]
              const localTpm = userLimits[u.apimSub]
              const tpmDirty = lt === 'tpm' && localTpm !== undefined && localTpm !== String(liveTpm ?? config.defaultTpm)
              const liveCost = costLimits?.users[u.apimSub]
              const localCost = editUserCost[u.apimSub]
              const costDirty = lt === 'cost' && localCost !== undefined && localCost !== String(liveCost ?? '')
              return (
                <div key={u.apimSub} className="px-4 sm:px-5 py-3">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white flex-1 truncate">{u.display}</span>
                    <GroupBadge groupId={u.group} />
                    <select
                      value={lt}
                      onChange={e => setUserLimitTypes(prev => ({ ...prev, [u.apimSub]: e.target.value as 'tpm' | 'cost' }))}
                      className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="tpm">Rate limit (TPM)</option>
                      <option value="cost">Monthly budget ($)</option>
                    </select>
                  </div>
                  {lt === 'tpm' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min="0"
                        value={effectiveUserLimits[u.apimSub]}
                        onChange={e => setUserLimits(prev => ({ ...prev, [u.apimSub]: e.target.value }))}
                        className={`w-28 text-sm bg-white dark:bg-gray-800 border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${tpmDirty ? 'border-amber-400 dark:border-amber-500 text-amber-700 dark:text-amber-300' : 'border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white'}`}
                      />
                      <span className="text-xs text-gray-400">tokens / min</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">$</span>
                        <input
                          type="number" min="0" step="0.01" placeholder="no limit"
                          value={localCost ?? (liveCost != null ? String(liveCost) : '')}
                          onChange={e => setEditUserCost(prev => ({ ...prev, [u.apimSub]: e.target.value }))}
                          className={`w-24 text-sm bg-white dark:bg-gray-800 border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${costDirty ? 'border-amber-400 dark:border-amber-500 text-amber-700 dark:text-amber-300' : 'border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white'}`}
                        />
                        <span className="text-xs text-gray-400">/ mo</span>
                      </div>
                      <TokenEquivHint budgetStr={localCost ?? (liveCost != null ? String(liveCost) : '')} depNames={deployments} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Row 4: Per-Deployment limits (full width) ───────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">Per-Deployment Limits</span>
            <p className="text-xs text-gray-400 mt-0.5">Rate limit (TPM) enforced by APIM, or monthly cost budget converted to an equivalent TPM.</p>
          </div>
          <button
            onClick={() => refetchDeps()}
            disabled={depsFetching}
            title="Refresh deployments from Foundry"
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className={depsFetching ? 'animate-spin' : ''} />
            {depsFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {!foundryName ? (
          <div className="p-5 text-sm text-gray-400">Select a Foundry resource to see deployment-level limits.</div>
        ) : deployments.length === 0 ? (
          <div className="p-5 text-sm text-gray-400">No deployments found.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {deployments.map(dep => {
              const lt       = depLimitTypes[dep] ?? 'tpm'
              const liveCfg  = costLimits?.depLimitConfigs?.[dep]
              const liveVal  = policy?.limits?.[dep]
              const localVal = depLimits[dep]
              const tpmDirty = lt === 'tpm' && localVal !== undefined && localVal !== String(liveVal ?? config.defaultTpm)

              // TPM equivalent preview for cost mode
              const costVal  = parseFloat((depCostValues[dep] ?? (liveCfg?.type === 'cost' ? String(liveCfg.value) : '0')) || '0')
              const depBlended = blendedPer1K(detectModelPricing(dep).pricing)
              const tpmEquiv = lt === 'cost' && costVal > 0 && depBlended > 0
                ? Math.max(1, Math.floor((costVal / depBlended) * 1_000 / 43_200))
                : null

              return (
                <div key={dep} className="px-4 sm:px-5 py-4">
                  {/* Row: dep name + type selector */}
                  <div className="flex items-center gap-3 mb-3">
                    <span className="font-mono text-xs font-medium text-gray-900 dark:text-white flex-1 truncate">{dep}</span>
                    <select
                      value={lt}
                      onChange={e => setDepLimitTypes(prev => ({ ...prev, [dep]: e.target.value as 'tpm' | 'cost' }))}
                      className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="tpm">Rate limit (TPM)</option>
                      <option value="cost">Monthly budget ($)</option>
                    </select>
                  </div>

                  {lt === 'tpm' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min="0"
                        value={effectiveDepLimits[dep]}
                        onChange={e => setDepLimits(prev => ({ ...prev, [dep]: e.target.value }))}
                        className={`w-32 text-sm bg-white dark:bg-gray-800 border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${tpmDirty ? 'border-amber-400 dark:border-amber-500 text-amber-700 dark:text-amber-300' : 'border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white'}`}
                      />
                      <span className="text-xs text-gray-400">tokens / min</span>
                    </div>
                  ) : (() => {
                    const { key: pKey, pricing } = detectModelPricing(dep)
                    const inTok   = costVal > 0 ? Math.round(costVal * 1_000_000 / pricing.input)  : 0
                    const cachTok = costVal > 0 ? Math.round(costVal * 1_000_000 / pricing.cachedInput) : 0
                    const outTok  = costVal > 0 ? Math.round(costVal * 1_000_000 / pricing.output) : 0
                    return (
                    <div className="space-y-3">
                      {/* Budget input */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Budget</span>
                        <span className="text-xs text-gray-400">$</span>
                        <input
                          type="number" min="0" step="0.01" placeholder="0.00"
                          value={depCostValues[dep] ?? (liveCfg?.type === 'cost' ? String(liveCfg.value) : '')}
                          onChange={e => setDepCostValues(prev => ({ ...prev, [dep]: e.target.value }))}
                          className="w-24 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-xs text-gray-400">/ mo</span>
                      </div>

                      {/* Pricing breakdown table */}
                      <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 overflow-hidden">
                        <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Azure Pricing — {pKey} · Global Standard
                          </span>
                          <a
                            href="https://azure.microsoft.com/en-us/pricing/details/azure-openai/"
                            target="_blank" rel="noopener noreferrer"
                            className="text-[9px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                          >source ↗</a>
                        </div>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-gray-400 dark:text-gray-500 text-left">
                              <th className="px-3 py-1.5 font-medium">Request Type</th>
                              <th className="px-3 py-1.5 font-medium text-right">Rate / 1M tokens</th>
                              {costVal > 0 && <th className="px-3 py-1.5 font-medium text-right">Budget Equiv</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            <tr>
                              <td className="px-3 py-1.5 text-green-700 dark:text-green-400 font-medium">Input</td>
                              <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-300">${pricing.input}</td>
                              {costVal > 0 && <td className="px-3 py-1.5 text-right font-mono text-green-600 dark:text-green-400">{fmtTokShort(inTok)} tok</td>}
                            </tr>
                            <tr>
                              <td className="px-3 py-1.5 text-cyan-700 dark:text-cyan-400 font-medium">Cached Input</td>
                              <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-300">${pricing.cachedInput}</td>
                              {costVal > 0 && <td className="px-3 py-1.5 text-right font-mono text-cyan-600 dark:text-cyan-400">{fmtTokShort(cachTok)} tok</td>}
                            </tr>
                            <tr>
                              <td className="px-3 py-1.5 text-amber-700 dark:text-amber-400 font-medium">Output</td>
                              <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-300">${pricing.output}</td>
                              {costVal > 0 && <td className="px-3 py-1.5 text-right font-mono text-amber-600 dark:text-amber-400">{fmtTokShort(outTok)} tok</td>}
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* TPM equivalent */}
                      {tpmEquiv !== null && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full font-medium">
                            ≈ {tpmEquiv.toLocaleString()} TPM enforced in APIM
                          </span>
                          <span className="text-[10px] text-gray-400">
                            blended ${(blendedPer1K(pricing) * 1_000).toFixed(2)}/1M · 75% in / 25% out · {fmtTokShort(Math.round((costVal / blendedPer1K(pricing)) * 1_000))} tok/mo ÷ 43,200 min/mo
                          </span>
                        </div>
                      )}
                    </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Pending changes + actions ────────────────────────────────────────── */}
      {totalPending > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 space-y-1">
          <p><strong>{totalPending}</strong> pending change{totalPending > 1 ? 's' : ''}:</p>
          {pendingDeps.length > 0 && <p className="text-xs">Deployments: {pendingDeps.join(', ')}</p>}
          {pendingUsers.length > 0 && <p className="text-xs">Users: {pendingUsers.map(u => u.display).join(', ')}</p>}
          {pendingGroups.length > 0 && <p className="text-xs">Groups: {pendingGroups.map(g => g.display).join(', ')}</p>}
          {pendingDefault && <p className="text-xs">Global default TPM changed</p>}
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
      {success && <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-300">{success}</div>}

      <div className="flex items-center gap-3">
        <button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          <Save size={15} />
          {applyMutation.isPending ? 'Applying…' : 'Apply to APIM'}
        </button>
        <button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 transition-colors">
          <Trash2 size={15} />
          {resetMutation.isPending ? 'Resetting…' : 'Reset policy'}
        </button>
      </div>

      {policy !== undefined && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <button onClick={() => setXmlOpen(o => !o)}
            className="w-full px-5 py-3 flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <span>Current policy XML (live from APIM)</span>
            {xmlOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {xmlOpen && (
            <div className="border-t border-gray-100 dark:border-gray-800">
              {policy.xml
                ? <XmlCodeView xml={policy.xml} />
                : <p className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500 italic">No policy configured yet.</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Model Pricing Reference ────────────────────────────────────────── */}
      <PricingReferenceTable get={get} />
    </div>
  )
}

// ── Pricing Reference Table (with live-refresh) ──────────────────────────────
interface LivePricing { input: number; cachedInput: number; output: number }

function PricingReferenceTable({ get }: { get: <T>(path: string) => Promise<T> }) {
  const [livePricing, setLivePricing] = useState<Record<string, LivePricing> | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const pricing = livePricing ?? MODEL_PRICING
  const fmt = (n: number) => {
    const dec = (n.toString().split('.')[1] || '').length
    return n.toFixed(Math.max(2, dec))
  }

  async function handleRefresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const res = await get<{ pricing: Record<string, LivePricing>; errors: string[] }>('/api/pricing')
      setLivePricing(res.pricing)
      setLastRefreshed(new Date())
      if (res.errors?.length) {
        setRefreshError(`Partial: ${res.errors.join('; ')}`)
      }
    } catch (e: unknown) {
      setRefreshError(e instanceof Error ? e.message : 'Failed to fetch pricing')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Model Pricing Reference</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Official Azure Global Standard prices per 1 M tokens — used for all cost estimates.
            {lastRefreshed && (
              <span className="ml-2 text-green-500 dark:text-green-400">
                · Live data fetched {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
              bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Fetching…' : 'Refresh Pricing'}
          </button>
          {Object.entries(PRICING_SOURCES).map(([key, url]) => (
            <a key={key} href={url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg
                bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50
                transition-colors">
              {key === 'openai' ? 'OpenAI' : key === 'deepseek' ? 'DeepSeek' : key === 'kimi' ? 'Kimi' : key === 'llama' ? 'Llama' : 'Microsoft'}
              <ExternalLink size={10} />
            </a>
          ))}
        </div>
      </div>
      {refreshError && (
        <p className="text-xs text-red-500 dark:text-red-400 mb-2">{refreshError}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
              <th className="pb-2 pr-4 font-semibold text-gray-500 dark:text-gray-400">Model</th>
              <th className="pb-2 px-4 font-semibold text-gray-500 dark:text-gray-400 text-right">Input</th>
              <th className="pb-2 px-4 font-semibold text-gray-500 dark:text-gray-400 text-right">Cached Input</th>
              <th className="pb-2 pl-4 font-semibold text-gray-500 dark:text-gray-400 text-right">Output</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(pricing).map(([model, p]) => (
              <tr key={model} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <td className="py-1.5 pr-4 font-mono text-gray-700 dark:text-gray-300">{model}</td>
                <td className="py-1.5 px-4 text-right text-green-600 dark:text-green-400 font-semibold">${fmt(p.input)}</td>
                <td className="py-1.5 px-4 text-right text-sky-600 dark:text-sky-400 font-semibold">
                  {p.cachedInput ? `$${fmt(p.cachedInput)}` : '—'}
                </td>
                <td className="py-1.5 pl-4 text-right text-amber-600 dark:text-amber-400 font-semibold">${fmt(p.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
