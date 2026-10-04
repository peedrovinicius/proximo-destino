import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// This drill only supports the disposable PostgreSQL container in GitHub CI.
// It deliberately ignores DATABASE_URL and has no production connection input.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run only in GitHub CI')
assert.equal(process.env.NODE_ENV, 'test', 'Run only with NODE_ENV=test')
const container = process.env.RECOVERY_DRILL_CONTAINER ?? ''
assert.match(container, /^[a-f0-9]{12,64}$/, 'CI PostgreSQL container is required')
const sourceName = 'recovery_drill_source'
const targetName = 'recovery_drill_restored'
const sourceUrl = `postgresql://postgres:postgres@127.0.0.1:5432/${sourceName}?schema=public`
const targetUrl = `postgresql://postgres:postgres@127.0.0.1:5432/${targetName}?schema=public`
const env = { ...process.env, PII_ENCRYPTION_KEY: 'recovery-drill-key-not-for-production' }
process.env.PII_ENCRYPTION_KEY = env.PII_ENCRYPTION_KEY
const require = createRequire(import.meta.url)
const { encryptedDocumentFields, decryptSensitive } = require('../dist/security/sensitive-data.js')
function pg(...args) {
  return execFileSync('docker', ['exec', container, ...args], { encoding: 'utf8', stdio: 'pipe' })
}
// createdb fails if a database already exists: never overwrite a previous database.
pg('createdb', '-U', 'postgres', sourceName)
pg('createdb', '-U', 'postgres', targetName)
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  env: { ...env, DATABASE_URL: sourceUrl }, stdio: 'pipe',
})
const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } })
const restored = new PrismaClient({ datasources: { db: { url: targetUrl } } })
const sensitiveTables = ['Client', 'Companion', 'Reservation', 'ReservationPassenger',
  'SeatAssignment', 'PurchaseOrder', 'Quote', 'FinancePlan', 'Installment',
  'TravelDocument', 'ManualPayment', 'ClientCreditTransaction']

async function fingerprint(db) {
  const tables = await db.$queryRawUnsafe(`
    SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename
  `)
  const data = []
  for (const { name } of tables) {
    const quoted = '"' + name.replaceAll('"', '""') + '"'
    const [row] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count,
        md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS digest
      FROM public.${quoted} t
    `)
    data.push({ name, ...row })
  }
  const columns = await db.$queryRawUnsafe(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name, ordinal_position
  `)
  const constraints = await db.$queryRawUnsafe(`
    SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    ORDER BY c.relname, con.conname
  `)
  const indexes = await db.$queryRawUnsafe(`
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'
    ORDER BY tablename, indexname
  `)
  const rls = await db.$queryRawUnsafe(`
    SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname
  `)
  const policies = await db.$queryRawUnsafe(`
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname
  `)
  return { data, columns, constraints, indexes, rls, policies }
}

try {
  const documentValue = '00000000000' // Deliberately invalid, fictitious document.
  const document = encryptedDocumentFields(documentValue)
  const client = await source.client.create({ data: {
    fullName: 'Cliente fictício do ensaio', email: 'recovery@example.invalid', ...document,
    companions: { create: { fullName: 'Acompanhante fictício', ...encryptedDocumentFields(documentValue) } },
  } })
  const trip = await source.trip.create({ data: {
    title: 'Viagem fictícia', origin: 'Origem de teste', destination: 'Destino de teste',
    departureDate: new Date('2030-01-01T12:00:00Z'), capacity: 44,
    imageData: Buffer.from('synthetic-image'), imageMimeType: 'image/png',
  } })
  const reservation = await source.reservation.create({ data: {
    clientId: client.id, tripId: trip.id, passengerCount: 1,
    passengers: { create: { sequence: 1, isPrimary: true, ...encryptedDocumentFields(documentValue) } },
  }, include: { passengers: true } })
  await source.seatAssignment.create({ data: {
    tripId: trip.id, reservationId: reservation.id, passengerId: reservation.passengers[0].id, seatNumber: 1,
  } })
  const quote = await source.quote.create({ data: {
    reservationId: reservation.id, revision: 1, title: 'Cotação fictícia',
    subtotalCostCents: 6000, subtotalSaleCents: 10000, totalCents: 10000, marginCents: 4000,
  } })
  await source.financePlan.create({ data: {
    reservationId: reservation.id, quoteId: quote.id, totalCents: 10000, installmentCount: 2,
    installments: { create: [1, 2].map(sequence => ({
      sequence, amountCents: 5000, dueDate: new Date('2030-01-01T12:00:00Z'),
    })) },
  } })
  await source.purchaseOrder.create({ data: {
    reservationId: reservation.id, paymentMethod: 'PIX', unitPriceCents: 10000,
    passengerCount: 1, totalCents: 10000,
  } })
  await source.travelDocument.create({ data: {
    reservationId: reservation.id, type: 'TRAVEL_VOUCHER', version: 1,
    documentNumber: 'RECOVERY-TEST-1', verificationCode: 'recovery-test-only',
    snapshot: { synthetic: true, seats: [1], amountCents: 10000 },
  } })
  const before = await fingerprint(source)
  pg('pg_dump', '-U', 'postgres', '--format=custom', '--no-owner', '--no-privileges',
    '--file=/tmp/proximo-destino-recovery-drill.dump', sourceName)
  await source.$disconnect()
  pg('pg_restore', '-U', 'postgres', '--exit-on-error', '--single-transaction',
    '--no-owner', '--no-privileges', '--dbname=' + targetName, '/tmp/proximo-destino-recovery-drill.dump')
  assert.deepEqual(await fingerprint(restored), before, 'Schema, records or RLS changed in restore')
  for (const name of sensitiveTables) {
    assert.equal(before.rls.find(row => row.name === name)?.enabled, true)
    assert.ok(before.policies.some(row => row.tablename === name))
  }
  const migrations = await restored.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `)
  const expected = readdirSync('prisma/migrations', { withFileTypes: true }).filter(entry => entry.isDirectory()).length
  assert.equal(migrations[0].total, expected)
  for (const model of [restored.client, restored.companion, restored.reservationPassenger]) {
    const record = await model.findFirstOrThrow()
    assert.equal(record.document, null)
    assert.equal(decryptSensitive(record.documentEncrypted), documentValue)
    assert.equal(record.documentHash, document.documentHash)
  }
  process.env.PII_ENCRYPTION_KEY = 'wrong-key-for-negative-recovery-test'
  assert.throws(() => decryptSensitive(document.documentEncrypted), 'A wrong key must not decrypt the backup')
  process.env.PII_ENCRYPTION_KEY = env.PII_ENCRYPTION_KEY
  const plan = await restored.financePlan.findFirstOrThrow({ include: { installments: true } })
  assert.equal(plan.installments.reduce((sum, installment) => sum + installment.amountCents, 0), plan.totalCents)
  console.log(`Recovery drill passed: ${expected} migrations, 12 RLS tables, schema and records identical, encrypted fields readable, finance reconciled.`)
} finally {
  await source.$disconnect()
  await restored.$disconnect()
  // GitHub destroys this disposable container at job end; never drop remote databases.
}
