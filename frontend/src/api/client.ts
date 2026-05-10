import { useMsal } from '@azure/msal-react'
import { ARM_SCOPES } from '../auth/msalConfig'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getToken(instance: any, accounts: any[]) {
  const r = await instance.acquireTokenSilent({ scopes: ARM_SCOPES, account: accounts[0] })
  return r.accessToken as string
}

export function useApiClient() {
  const { instance, accounts } = useMsal()

  async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await getToken(instance, accounts)
    const url = new URL(path, window.location.origin)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
    return r.json()
  }

  async function put<T>(path: string, params: Record<string, string>, body: unknown): Promise<T> {
    const token = await getToken(instance, accounts)
    const url = new URL(path, window.location.origin)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const r = await fetch(url.toString(), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
    return r.json()
  }

  async function remove<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await getToken(instance, accounts)
    const url = new URL(path, window.location.origin)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const r = await fetch(url.toString(), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
    return r.json()
  }

  return { get, put, remove }
}
