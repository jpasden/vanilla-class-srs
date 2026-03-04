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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) {
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
export async function uploadFile<T>(path: string, file: File, fieldName = 'file'): Promise<T> {
  const form = new FormData()
  form.append(fieldName, file)
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
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
