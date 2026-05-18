import { createContext, useContext } from 'react'

export interface ActiveEnrollment {
  enrollmentId: string
  className: string
  subjectGradeName: string
}

export interface EnrollmentContextValue {
  active: ActiveEnrollment | null
  setActive: (e: ActiveEnrollment | null) => void
  enrollmentCount: number
  setEnrollmentCount: (n: number) => void
}

export const EnrollmentContext = createContext<EnrollmentContextValue>({
  active: null,
  setActive: () => {},
  enrollmentCount: 0,
  setEnrollmentCount: () => {},
})

export function useEnrollment() {
  return useContext(EnrollmentContext)
}
