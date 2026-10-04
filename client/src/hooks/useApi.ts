import { useState, useEffect, useCallback, useRef } from 'react'
import { ApiError } from '../utils/api'

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const sequence = useRef(0)
  const load = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      if (request === sequence.current) setData(result)
    } catch (e) {
      if (request === sequence.current) {
        setData(null)
        setError(e instanceof ApiError ? e.message : 'An unexpected error occurred')
      }
    } finally {
      if (request === sequence.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    load()
    return () => {
      sequence.current++
    }
  }, [load])

  return { data, error, loading, reload: load }
}
