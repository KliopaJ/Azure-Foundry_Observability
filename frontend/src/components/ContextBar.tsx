import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useApiClient } from '../api/client'
import { useApp } from '../context/AppContext'
import { Subscription, FoundryResource } from '../types'

export default function ContextBar() {
  const { get } = useApiClient()
  const qc = useQueryClient()
  const {
    subId, setSubId,
    rg, setRg,
    foundryName, setFoundryName,
    project, setProject,
  } = useApp()

  const { data: subs = [] } = useQuery<Subscription[]>({
    queryKey: ['subscriptions'],
    queryFn: () => get('/api/subscriptions'),
  })

  const { data: resources = [] } = useQuery<FoundryResource[]>({
    queryKey: ['resources', subId],
    queryFn: () => get('/api/foundry-resources', { sub_id: subId }),
    enabled: !!subId,
  })

  const { data: projects = [] } = useQuery<string[]>({
    queryKey: ['projects', subId, foundryName],
    queryFn: () => {
      const res = resources.find(r => r.name === foundryName)
      return get('/api/projects', { sub_id: subId, rg: res?.rg ?? '', foundry: foundryName })
    },
    enabled: !!subId && !!foundryName,
  })

  const isAllSubs = subId === '__all__'
  const isAllResources = foundryName === '__all__'

  // Auto-select first subscription
  useEffect(() => {
    if (!subId && subs.length > 0) setSubId(subs[0].id)
  }, [subs, subId, setSubId])

  // Auto-select first resource (or "All resources" when "All subscriptions" is chosen)
  useEffect(() => {
    if (resources.length > 0 && !foundryName) {
      if (subId === '__all__') {
        setFoundryName('__all__')
        setRg('__all__')
      } else {
        setFoundryName(resources[0].name)
        setRg(resources[0].rg)
      }
    }
  }, [resources, foundryName, subId, setFoundryName, setRg])

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 flex-1">
        <Sel
          label="Subscription"
          value={subId}
          onChange={v => { setSubId(v); setFoundryName(''); setProject(''); setRg('') }}
          options={[
            { value: '__all__', label: '\u{1F310} All subscriptions' },
            ...subs.map(s => ({ value: s.id, label: s.name })),
          ]}
        />
        <Sel
          label="Foundry Resource"
          value={foundryName}
          onChange={v => {
            if (v === '__all__') {
              setFoundryName('__all__')
              setRg('__all__')
              setProject('')
            } else {
              const r = resources.find(x => x.name === v)
              setFoundryName(v)
              if (r) setRg(r.rg)
              setProject('')
            }
          }}
          options={[
            { value: '__all__', label: '\u{1F310} All resources' },
            ...resources.map(r => ({
              value: r.name,
              label: isAllSubs && r.subName ? `${r.name} (${r.subName})` : r.name,
            })),
          ]}
          disabled={!subId}
        />
        <Sel
          label="Project"
          value={project}
          onChange={setProject}
          options={[{ value: '', label: 'All projects' }, ...projects.map(p => ({ value: p, label: p }))]}
          disabled={!foundryName || isAllResources}
        />
      </div>
      <button
        onClick={() => qc.invalidateQueries()}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors sm:flex-shrink-0"
      >
        <RefreshCw size={13} />
        Refresh
      </button>
    </div>
  )
}

function Sel({
  label, value, onChange, options, disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
