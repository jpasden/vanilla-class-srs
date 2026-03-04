import { useState, useEffect, useCallback, ReactNode } from 'react'
import { api, ApiError } from '../utils/api'
import { AuthContext, AuthUser } from '../utils/auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api.post<{ user: AuthUser }>('/auth/refresh')
      setUser(data.user)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const login = async (email: string, password: string) => {
    const data = await api.post<{ user: AuthUser }>('/auth/login', { email, password })
    setUser(data.user)
  }

  const logout = async () => {
    try { await api.post('/auth/logout') } catch { /* ignore */ }
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
