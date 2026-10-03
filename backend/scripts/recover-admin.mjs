// Recovery utility for controlled administrator access restoration.
import { PrismaClient, UserRole } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()
const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const newPassword = process.env.ADMIN_NEW_PASSWORD ?? process.env.ADMIN_PASSWORD
const resetMfa = process.env.ADMIN_RESET_MFA === 'true'

if (!newPassword || newPassword.length < 16) {
  console.error('Defina ADMIN_NEW_PASSWORD ou ADMIN_PASSWORD com senha de pelo menos 16 caracteres.')
  process.exit(1)
}

try {
  let user = configuredEmail
    ? await prisma.user.findUnique({ where: { email: configuredEmail } })
    : null

  if (!configuredEmail) {
    const admins = await prisma.user.findMany({
      where: { role: UserRole.ADMIN, isActive: true },
      orderBy: { createdAt: 'asc' },
      take: 2,
    })

    if (admins.length !== 1) {
      console.error('Não foi possível determinar um único administrador ativo.')
      process.exit(2)
    }

    user = admins[0]
  }

  if (!user || user.role !== UserRole.ADMIN) {
    console.error('Administrador não encontrado.')
    process.exit(2)
  }

  const email = user.email

  const operations = [
    prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }),
        failedLoginAttempts: 0,
        lockedUntil: null,
        refreshTokenHash: null,
        ...(resetMfa
          ? {
              mfaEnabled: false,
              mfaSecretEncrypted: null,
              mfaPendingSecretEncrypted: null,
              mfaEnrolledAt: null,
            }
          : {}),
      },
    }),
    prisma.authAuditEvent.create({
      data: {
        userId: user.id,
        eventType: resetMfa
          ? 'ADMIN_EMERGENCY_RECOVERY_WITH_MFA_RESET'
          : 'ADMIN_EMERGENCY_PASSWORD_RECOVERY',
      },
    }),
  ]

  if (resetMfa) {
    operations.push(
      prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    )
  }

  await prisma.$transaction(operations)
  console.log(JSON.stringify({
    email,
    sessionsRevoked: true,
    mfaReset: resetMfa,
  }, null, 2))
} finally {
  await prisma.$disconnect()
}
