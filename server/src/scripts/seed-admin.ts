/**
 * Creates the initial admin user if one does not already exist.
 * Safe to re-run — exits early if an admin is already present.
 *
 * Usage:
 *   docker compose exec server npx tsx src/scripts/seed-admin.ts
 *
 * Prompts for email and name, then prints the temporary password.
 * The admin must change their password on first login.
 */

import * as readline from 'readline/promises'
import { PrismaClient, Role } from '@prisma/client'
import { hashPassword } from '../services/auth.service'

const prisma = new PrismaClient()

function generateAdminTempPassword(name: string): string {
  const d = new Date()
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '')
  const lastName = name.trim().split(/\s+/).pop()!.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${dateStr}${lastName}`
}

async function main() {
  const existingAdmin = await prisma.user.findFirst({ where: { role: Role.ADMIN } })
  if (existingAdmin) {
    console.log(`\nAdmin already exists: ${existingAdmin.email}\nNo changes made.\n`)
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const email = (await rl.question('Admin email: ')).trim()
  const name  = (await rl.question('Admin name:  ')).trim()
  rl.close()

  if (!email || !name) {
    console.error('Email and name are required.')
    process.exit(1)
  }

  const tempPassword = generateAdminTempPassword(name)
  const passwordHash = await hashPassword(tempPassword)

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name, passwordHash, role: Role.ADMIN, mustChangePassword: true },
    })
    await tx.teacher.create({ data: { userId: user.id } })
  })

  console.log(`
✓ Admin created

  Email:    ${email}
  Password: ${tempPassword}

  The admin must change this password on first login.
`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
