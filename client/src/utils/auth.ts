import { createContext, useContext } from 'react'

export interface AuthUser {
  sub: string
  email: string
  name: string
  role: 'ADMIN' | 'TEACHER' | 'STUDENT'
  mustChangePassword: boolean
}

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}
