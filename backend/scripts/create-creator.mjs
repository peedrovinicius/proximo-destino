import { PrismaClient, UserRole } from '@prisma/client'
import argon2 from 'argon2'

// Explicit provisioning only. Never promote an existing company or customer account.
const email = process.env.CREATOR_EMAIL?.trim().toLowerCase()
const password = process.env.CREATOR_PASSWORD
if (process.env.COMPANY_FOUNDATION_ENABLED !== 'true' || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 16) {
  console.error('Requer COMPANY_FOUNDATION_ENABLED=true, CREATOR_EMAIL e CREATOR_PASSWORD (mínimo 16 caracteres).')
  process.exit(1)
}
const prisma = new PrismaClient()
try {
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    console.error('A conta já existe. Nenhum perfil ou credencial foi alterado.')
    process.exitCode = 2
  } else {
    const user = await prisma.user.create({ data: {
      email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role: UserRole.CREATOR, isActive: true, mfaEnabled: false,
    }, select: { id: true, role: true } })
    console.log(JSON.stringify({ ...user, nextStep: 'Primeiro login exige cadastrar e confirmar MFA. Nenhuma empresa foi ativada.' }))
  }
} finally { await prisma.$disconnect() }
