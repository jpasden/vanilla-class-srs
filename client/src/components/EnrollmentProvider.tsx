import { useState, ReactNode } from 'react'
import { EnrollmentContext, ActiveEnrollment } from '../utils/enrollment'

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveEnrollment | null>(null)
  const [enrollmentCount, setEnrollmentCount] = useState(0)
  return (
    <EnrollmentContext.Provider value={{ active, setActive, enrollmentCount, setEnrollmentCount }}>
      {children}
    </EnrollmentContext.Provider>
  )
}
