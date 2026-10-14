export function confirmCrossSubjectCopy(
  source: { name: string; subjectGrade?: { id: string; name: string } | null } | undefined,
  destination: { id: string; name: string } | undefined,
): boolean {
  if (!source || !destination || !source.subjectGrade || source.subjectGrade.id === destination.id) return true
  return window.confirm(
    `“${source.name}” belongs to ${source.subjectGrade.name}. Assigning it here will create an independent copy in ${destination.name}, or reuse the existing destination copy. Later edits will not sync between the sets. Continue?`,
  )
}
