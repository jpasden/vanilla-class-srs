import nodemailer from 'nodemailer'

function createTransport() {
  const host = process.env.SMTP_HOST
  if (!host) return null // SMTP not configured — skip sending

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const transport = createTransport()
  if (!transport) {
    // Log to console so the link is usable in development without SMTP
    console.log(`[DEV] Password reset link for ${to}: ${resetUrl}`)
    return
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM ?? 'noreply@example.com',
    to,
    subject: 'Reset your Vanilla Class SRS password',
    text: `Click the link below to reset your password. It expires in 1 hour.\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click the link below to reset your password. It expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
  })
}
