import { useState, ReactNode } from 'react'
import { EnrollmentContext, ActiveEnrollment } from '../utils/enrollment'

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveEnrollment | null>(null)
  return (
    <EnrollmentContext.Provider value={{ active, setActive }}>
      {children}
    </EnrollmentContext.Provider>
  )
}
