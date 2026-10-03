import { PrismaClient, UserRole } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD

if (!email || !password || password.length < 16) {
  console.error('Defina ADMIN_EMAIL e ADMIN_PASSWORD com senha de pelo menos 16 caracteres.')
  process.exit(1)
}

try {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.error('Administrador já existe. Use admin:recover para recuperação operacional.')
    process.exit(2)
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role: UserRole.ADMIN,
      isActive: true,
      mfaEnabled: false,
    },
    select: { id: true, email: true, role: true, isActive: true },
  })

  console.log(JSON.stringify({
    ...user,
    nextStep: 'No primeiro login o MFA será obrigatório.',
  }, null, 2))
} finally {
  await prisma.$disconnect()
}
