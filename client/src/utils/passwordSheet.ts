/**
 * Shared helpers for handing out one-time temp passwords — used by the CSV
 * enrollment import, the teacher's student password-reset flows, and admin's
 * teacher password-reset flow. Passwords are hashed on creation and never
 * retrievable again, so this is the only chance to get them to the person
 * who needs to hand them out.
 *
 * `PasswordSheetRow.studentName` keeps its original field name for backward
 * compatibility with existing call sites/API response shapes (renaming it
 * would ripple into the teacher-reset-password API response type too) —
 * despite the name, it holds whichever person's name is relevant (a
 * student's, or a teacher's for the admin flow). The row label and print
 * subtitle are separately parameterized so each caller controls its own
 * wording without touching the others.
 */

export interface PasswordSheetRow {
  studentName: string
  tempPassword: string
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function downloadPasswordSheet(rows: PasswordSheetRow[], nameLabel = 'Student'): void {
  const lines = [`${nameLabel},Temporary Password`, ...rows.map((r) => `${csvEscape(r.studentName)},${r.tempPassword}`)]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'temp-passwords.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function printPasswordSlips(rows: PasswordSheetRow[], subtitle: string): void {
  const win = window.open('', '_blank')
  if (!win) return

  const slips = rows.map((r) => `
    <div class="slip">
      <div class="class-name">${subtitle}</div>
      <div class="student-name">${r.studentName}</div>
      <div class="password">${r.tempPassword}</div>
      <div class="note">Change this password when you first log in.</div>
    </div>
  `).join('')

  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Temporary Passwords — ${subtitle}</title>
        <style>
          body { font-family: sans-serif; margin: 0; }
          .slip {
            width: 100%; box-sizing: border-box; padding: 16px 20px;
            border-bottom: 1px dashed #999; page-break-inside: avoid;
          }
          .class-name { font-size: 12px; color: #666; }
          .student-name { font-size: 16px; font-weight: 600; margin-top: 2px; }
          .password { font-family: monospace; font-size: 20px; font-weight: 700; letter-spacing: 1px; margin-top: 6px; }
          .note { font-size: 11px; color: #666; margin-top: 6px; }
        </style>
      </head>
      <body>${slips}</body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
}
