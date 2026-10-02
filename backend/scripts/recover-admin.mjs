// Recovery utility for controlled administrator access restoration.\nimport { PrismaClient, UserRole } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const newPassword = process.env.ADMIN_NEW_PASSWORD ?? process.env.ADMIN_PASSWORD
const resetMfa = process.env.ADMIN_RESET_MFA === 'true'

if (!email || !newPassword || newPassword.length < 16) {
  console.error('Defina ADMIN_EMAIL e ADMIN_NEW_PASSWORD ou ADMIN_PASSWORD com senha de pelo menos 16 caracteres.')
  process.exit(1)
}

try {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || user.role !== UserRole.ADMIN) {
    console.error('Administrador não encontrado.')
    process.exit(2)
  }

  const operations = [
    prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(newPassword),
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
