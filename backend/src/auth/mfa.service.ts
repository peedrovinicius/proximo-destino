import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto'
import * as QRCode from 'qrcode'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async beginSetup(userId: string, email: string) {
    const secret = this.base32Encode(randomBytes(20))
    const encrypted = this.encrypt(secret)

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaPendingSecretEncrypted: encrypted },
    })

    const issuer = 'Próximo Destino'
    const label = encodeURIComponent(`${issuer}:${email}`)
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
    const qrDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    })

    return { manualKey: secret, otpauthUrl: uri, qrDataUrl }
  }

  async confirmSetup(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaPendingSecretEncrypted: true },
    })

    if (!user?.mfaPendingSecretEncrypted) {
      throw new UnauthorizedException('Configuração de MFA expirada')
    }

    const secret = this.decrypt(user.mfaPendingSecretEncrypted)
    if (!this.verifyTotp(secret, code)) {
      throw new UnauthorizedException('Código inválido')
    }

    const recoveryCodes = Array.from({ length: 10 }, () => this.recoveryCode())
    const codeHashes = await Promise.all(recoveryCodes.map((value) => argon2.hash(value)))

    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecretEncrypted: this.encrypt(secret),
          mfaPendingSecretEncrypted: null,
          mfaEnrolledAt: new Date(),
        },
      }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ])

    return recoveryCodes
  }

  async verify(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase()
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecretEncrypted: true },
    })

    if (!user?.mfaEnabled || !user.mfaSecretEncrypted) {
      return false
    }

    const secret = this.decrypt(user.mfaSecretEncrypted)
    if (this.verifyTotp(secret, code)) {
      return true
    }

    const candidates = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    })

    for (const candidate of candidates) {
      if (await argon2.verify(candidate.codeHash, code)) {
        await this.prisma.mfaRecoveryCode.update({
          where: { id: candidate.id },
          data: { usedAt: new Date() },
        })
        return true
      }
    }

    return false
  }

  async reset(userId: string) {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          mfaPendingSecretEncrypted: null,
          mfaEnrolledAt: null,
        },
      }),
    ])
  }

  private verifyTotp(secret: string, code: string) {
    if (!/^\d{6}$/.test(code)) return false
    const counter = Math.floor(Date.now() / 1000 / 30)

    for (const offset of [-1, 0, 1]) {
      if (this.totp(secret, counter + offset) === code) return true
    }
    return false
  }

  private totp(secret: string, counter: number) {
    const key = this.base32Decode(secret)
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64BE(BigInt(counter))
    const digest = createHmac('sha1', key).update(buffer).digest()
    const offset = digest[digest.length - 1] & 0x0f
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)

    return String(binary % 1_000_000).padStart(6, '0')
  }

  private encrypt(value: string) {
    const key = this.encryptionKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.')
  }

  private decrypt(value: string) {
    const [ivRaw, tagRaw, encryptedRaw] = value.split('.')
    if (!ivRaw || !tagRaw || !encryptedRaw) {
      throw new UnauthorizedException('Configuração de MFA inválida')
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(ivRaw, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  }

  private encryptionKey() {
    const raw = this.config.getOrThrow<string>('MFA_ENCRYPTION_KEY')
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) {
      throw new Error('MFA_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64')
    }
    return key
  }

  private recoveryCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = randomBytes(12)
    let value = ''
    for (let index = 0; index < 12; index += 1) {
      value += alphabet[bytes[index] % alphabet.length]
    }
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`
  }

  private base32Encode(input: Buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = 0
    let value = 0
    let output = ''

    for (const byte of input) {
      value = (value << 8) | byte
      bits += 8
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31]
        bits -= 5
      }
    }

    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31]
    return output
  }

  private base32Decode(input: string) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = 0
    let value = 0
    const bytes: number[] = []

    for (const char of input.replace(/=+$/, '').toUpperCase()) {
      const index = alphabet.indexOf(char)
      if (index < 0) continue
      value = (value << 5) | index
      bits += 5
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255)
        bits -= 8
      }
    }

    return Buffer.from(bytes)
  }
}
