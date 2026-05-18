import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@example.com'
  const password = 'password123'
  const name = 'Admin User'

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log(`Admin already exists: ${email}`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await prisma.user.create({
    data: { email, name, passwordHash, role: 'ADMIN' },
  })

  console.log('─────────────────────────────────────')
  console.log('Seed complete. Admin account created:')
  console.log(`  Email:    ${email}`)
  console.log(`  Password: ${password}`)
  console.log('Change this password after first login.')
  console.log('─────────────────────────────────────')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
