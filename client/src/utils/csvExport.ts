/**
 * Generic client-side CSV export — builds a CSV in-memory and triggers a
 * browser download via a synthetic <a>. Same pattern as
 * passwordSheet.ts's downloadPasswordSheet, generalised for any tabular
 * data (headers + string rows) rather than one fixed shape.
 */

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const lines = [headers.map(csvEscape).join(','), ...rows.map((row) => row.map(csvEscape).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
