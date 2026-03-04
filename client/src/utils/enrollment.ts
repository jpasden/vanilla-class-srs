import { createContext, useContext } from 'react'

export interface ActiveEnrollment {
  enrollmentId: string
  className: string
  subjectGradeName: string
}

export interface EnrollmentContextValue {
  active: ActiveEnrollment | null
  setActive: (e: ActiveEnrollment | null) => void
}

export const EnrollmentContext = createContext<EnrollmentContextValue>({
  active: null,
  setActive: () => {},
})

export function useEnrollment() {
  return useContext(EnrollmentContext)
}
