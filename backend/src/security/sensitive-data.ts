import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
} from 'node:crypto'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

function rawSecret() {
  return (
    process.env.PII_ENCRYPTION_KEY?.trim() ||
    process.env.PAYMENT_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_ACCESS_SECRET?.trim() ||
    ''
  )
}

function key() {
  const secret = rawSecret()
  if (!secret) {
    throw new Error(
      'PII_ENCRYPTION_KEY não configurada para criptografia de dados sensíveis',
    )
  }

  return createHash('sha256').update(secret).digest()
}

export function sensitiveDataConfigured() {
  return Boolean(rawSecret())
}

export function encryptSensitive(
  value: string | null | undefined,
) {
  const normalized = value?.trim()
  if (!normalized) return null

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const encrypted = Buffer.concat([
    cipher.update(normalized, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

export function decryptSensitive(
  value: string | null | undefined,
) {
  if (!value) return null
  if (!value.startsWith(VERSION + '.')) {
    return value
  }

  const [version, ivRaw, tagRaw, encryptedRaw] =
    value.split('.')
  if (
    version !== VERSION ||
    !ivRaw ||
    !tagRaw ||
    !encryptedRaw
  ) {
    throw new Error('Dado sensível criptografado inválido')
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivRaw, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function hashSensitive(
  value: string | null | undefined,
) {
  const normalized = value?.trim()
  if (!normalized) return null

  return createHmac('sha256', key())
    .update(normalized)
    .digest('hex')
}

export function encryptedDocumentFields(
  value: string | null | undefined,
) {
  const normalized = value?.trim() || null

  return {
    document: null,
    documentEncrypted: encryptSensitive(normalized),
    documentHash: hashSensitive(normalized),
  }
}

export function revealDocument(input: {
  document?: string | null
  documentEncrypted?: string | null
}) {
  return (
    decryptSensitive(input.documentEncrypted) ??
    input.document ??
    null
  )
}
