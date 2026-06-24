// CardSetStatus.PRIVATE means "owned by one teacher, not shared with the department" —
// it has nothing to do with student visibility (a PRIVATE set is still fully visible to
// students once assigned to a class). "Teacher-Owned" reads less ambiguously than "Private".
export function cardSetStatusLabel(status: 'PRIVATE' | 'DEPARTMENTAL'): string {
  return status === 'PRIVATE' ? 'Teacher-Owned' : 'Departmental'
}
