// Opt-in real-network HTTP proof. Creates only an empty, randomly named database
// on one connector-verified, expiring branch. Never accepts a production host.
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const { assertHttpRehearsalTarget } = require('../dist/security/http-rehearsal-target.js')
const name = `validation_pr34_http_${randomBytes(12).toString('hex')}`
let admin, created = false, stage = 'validar configuração', exitCode = 1
try {
  stage = 'validar presença do segredo NEON_HTTP_OWNER_URL'
  if (!process.env.NEON_HTTP_OWNER_URL?.trim()) throw new Error('Ausente')
  stage = 'validar formato PostgreSQL do segredo (sem comando psql ou aspas externas)'
  const url = new URL(process.env.NEON_HTTP_OWNER_URL.trim())
  stage = 'validar banco base neondb'
  if (url.pathname !== '/neondb') throw new Error('Base inválida')
  const target = new URL(url); target.pathname = '/' + name
  stage = 'validar hostname, TLS, parâmetros e expiração da branch temporária'
  assertHttpRehearsalTarget(target)
  admin = new PrismaClient({ datasourceUrl: url.toString(), log: [], errorFormat: 'minimal' })
  stage = 'conectar à branch temporária'
  await admin.$connect()
  stage = 'criar banco fictício'
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE template0`)
  created = true
  // Do not inherit application/provider secrets or startup backfill flags.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
  Object.assign(env, { DATABASE_URL: target.toString(), NODE_ENV: 'test',
    COMPANY_FOUNDATION_ENABLED: 'true', FRONTEND_ORIGIN: 'http://127.0.0.1',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    JWT_MFA_SECRET: randomBytes(32).toString('hex'), AUDIT_HASH_KEY: randomBytes(32).toString('hex') })
  function run(args, label) {
    stage = label
    const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024 })
    // Captured child output can contain connection details. Never print it.
    if (result.error || result.status !== 0) throw new Error('Processo recusado')
  }
  run([require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], 'aplicar migrations no banco fictício')
  run(['--test', '--test-concurrency=1', 'dist/__tests__/company-restricted-http.spec.js'], 'executar HTTP com login PostgreSQL independente')
  console.log('Ensaio HTTP independente aprovado: isolamento A/B, gravações preparatórias, recusas e rollback de auditoria.')
  exitCode = 0
} catch {
  console.error(`Ensaio não aprovado na etapa: ${stage}. Nenhuma validação de produção realizada.`)
} finally {
  if (created && admin) {
    try {
      // Only this process's newly created, randomly named database is removed.
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`)
      console.log('Banco fictício do ensaio descartado.')
    } catch {
      console.error(`Descarte não confirmado: ${name}. A branch temporária tem expiração automática.`)
      exitCode = 1
    }
  }
  await admin?.$disconnect()
}
process.exitCode = exitCode
