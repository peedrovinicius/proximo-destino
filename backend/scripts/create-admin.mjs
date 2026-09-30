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
  const passwordHash = await argon2.hash(password)
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
      refreshTokenHash: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email,
      passwordHash,
      role: UserRole.ADMIN,
    },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
    },
  })

  console.log(JSON.stringify(user, null, 2))
} finally {
  await prisma.$disconnect()
}
