import { useState, ReactNode } from 'react'
import { EnrollmentContext, ActiveEnrollment } from '../utils/enrollment'

const STORAGE_KEY = 'vanilla_srs_active_enrollment'

function loadStored(): ActiveEnrollment | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState<ActiveEnrollment | null>(loadStored)
  const [enrollmentCount, setEnrollmentCount] = useState(0)

  const setActive = (e: ActiveEnrollment | null) => {
    setActiveState(e)
    if (e) localStorage.setItem(STORAGE_KEY, JSON.stringify(e))
    else localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <EnrollmentContext.Provider value={{ active, setActive, enrollmentCount, setEnrollmentCount }}>
      {children}
    </EnrollmentContext.Provider>
  )
}
