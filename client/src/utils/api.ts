/**
 * API client — thin wrapper around fetch.
 * All requests go to /api (proxied to http://localhost:3000 in dev).
 * Cookies (httpOnly JWT) are sent automatically via credentials: 'include'.
 */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// Serializes concurrent refresh attempts so simultaneous 401s don't each fire their own
// /auth/refresh call — they all await the same in-flight promise.
let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function request<T>(method: string, path: string, body?: unknown, isRetry = false): Promise<T> {
  const opts: RequestInit = {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) {
    // Access token expired mid-session — silently refresh via the refresh_token cookie
    // and retry once. Skip for the refresh/login endpoints themselves to avoid loops.
    if (res.status === 401 && !isRetry && path !== '/auth/refresh' && path !== '/auth/login') {
      const refreshed = await tryRefresh()
      if (refreshed) return request<T>(method, path, body, true)
    }
    let msg = res.statusText
    try { const j = await res.json(); msg = j.error ?? msg } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('Content-Type') ?? ''
  if (ct.includes('text/csv')) return res.blob() as unknown as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

/** Upload a file via multipart form data */
export async function uploadFile<T>(path: string, file: File, fieldName = 'file', isRetry = false): Promise<T> {
  const form = new FormData()
  form.append(fieldName, file)
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    if (res.status === 401 && !isRetry) {
      const refreshed = await tryRefresh()
      if (refreshed) return uploadFile<T>(path, file, fieldName, true)
    }
    let msg = res.statusText
    try { const j = await res.json(); msg = j.error ?? msg } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  return res.json()
}

/** Trigger a CSV file download from a blob response */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
