import assert from 'node:assert/strict'
import { before, after, describe, it } from 'node:test'
import { randomUUID, createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { ConflictException, UnauthorizedException } from '@nestjs/common'
import { UserRole, TripStatus, QuoteItemCategory, ManualPaymentMethod } from '@prisma/client'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import { AuditService } from '../auth/audit.service'
import { MfaService } from '../auth/mfa.service'
import { SessionService } from '../auth/session.service'
import { PortalService } from '../portal/portal.service'
import { TripsService } from '../trips/trips.service'
import { AdminService } from '../admin/admin.service'
import { CommercialService } from '../commercial/commercial.service'
import { readDatabaseSecurityState, restrictedAuditWriter } from '../security/database-privileges'

// Independent RFC 6238 test code, using only the synthetic enrollment secret.
function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, '0')
}

describe('fluxos reais com conexão PostgreSQL runtime restrita', () => {
  const owner = new PrismaService()
  const suffix = randomUUID().replaceAll('-', '')
  const role = `flow_${suffix}`
  const actorId = `flow-user-${suffix}`
  const tripId = `flow-trip-${suffix}`
  const actorEmail = `flow-admin-${suffix}@example.com`
  const clientEmail = `flow-client-${suffix}@example.com`
  const otherEmail = `flow-other-${suffix}@example.com`
  const password = `Synthetic-${randomUUID()}`
  let connected = false
  let roleCreated = false
  let runtime: PrismaService | undefined
  let reservationId: string
  let clientId: string
  const config = new ConfigService({
    JWT_ACCESS_SECRET: `synthetic-access-${suffix}`, JWT_REFRESH_SECRET: `synthetic-refresh-${suffix}`,
    JWT_MFA_SECRET: `synthetic-mfa-${suffix}`, AUDIT_HASH_KEY: `synthetic-audit-${suffix}`,
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  })
  const jwt = new JwtService()
  const db = () => { assert.ok(runtime); return runtime }
  const portal = () => new PortalService(db(), jwt, config)
  const auth = () => new AuthService(db(), jwt, config, new MfaService(db(), config),
    new SessionService(db(), config), new AuditService(db(), config))

  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    await owner.$connect()
    connected = true
    await owner.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`)
    roleCreated = true
    const psqlUrl = new URL(database)
    psqlUrl.searchParams.delete('schema')
    execFileSync('psql', [psqlUrl.toString(), '-X', '--set=ON_ERROR_STOP=1',
      `--set=runtime_role=${role}`, '--file=scripts/security/rehearse-runtime.sql'], { stdio: 'pipe' })
    // Generated UUID credentials are confined to the disposable local database.
    const dbPassword = randomUUID()
    await owner.$executeRawUnsafe(`ALTER ROLE "${role}" LOGIN PASSWORD '${dbPassword}'`)
    database.username = role
    database.password = dbPassword
    runtime = new PrismaService({ datasourceUrl: database.toString() })
    await runtime.$connect()
    const [identity] = await runtime.$queryRaw<Array<{ current: string; session: string }>>`
      SELECT current_user AS current, session_user AS session
    `
    assert.equal(identity.current, role)
    assert.equal(identity.session, role)
    assert.equal(restrictedAuditWriter(await readDatabaseSecurityState(runtime)), true)
    await runtime.user.create({ data: { id: actorId, email: actorEmail,
      passwordHash: await argon2.hash(password), role: UserRole.ADMIN } })
    await runtime.trip.create({ data: { id: tripId, title: 'Synthetic restricted flow',
      origin: 'Synthetic origin', destination: 'Synthetic destination',
      departureDate: new Date(Date.now() + 7 * 86400000), status: TripStatus.SCHEDULED,
      capacity: 4, priceCents: 10000 } })
  })

  after(async () => {
    await runtime?.$disconnect()
    if (!connected) return
    try {
      const reservations = await owner.reservation.findMany({ where: { tripId }, select: { id: true } })
      const ids = reservations.map(r => r.id)
      await owner.manualPayment.deleteMany({ where: { reservationId: { in: ids } } })
      await owner.travelDocument.deleteMany({ where: { reservationId: { in: ids } } })
      await owner.financePlan.deleteMany({ where: { reservationId: { in: ids } } })
      await owner.reservationService.deleteMany({ where: { reservationId: { in: ids } } })
      await owner.quote.deleteMany({ where: { reservationId: { in: ids } } })
      await owner.seatAssignment.deleteMany({ where: { tripId } })
      await owner.reservation.deleteMany({ where: { tripId } })
      await owner.client.deleteMany({ where: { email: { in: [clientEmail, otherEmail] } } })
      await owner.trip.deleteMany({ where: { id: tripId } })
      await owner.authAuditEvent.deleteMany({ where: { userId: actorId } })
      await owner.user.deleteMany({ where: { id: actorId } })
      if (roleCreated) {
        const policy = `api_runtime_${createHash('md5').update(role).digest('hex')}`
        const policies = await owner.$queryRaw<Array<{ tablename: string }>>`
          SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname=${policy}
        `
        for (const row of policies) await owner.$executeRawUnsafe(
          `DROP POLICY "${policy}" ON public."${row.tablename.replaceAll('"', '""')}"`)
        await owner.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        await owner.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
    } finally { await owner.$disconnect() }
  })

  it('login errado, matrícula MFA, recuperação, refresh e logout usam somente runtime', async () => {
    const service = auth()
    await assert.rejects(service.loginAdmin(actorEmail, 'wrong-synthetic-password', {}), UnauthorizedException)
    const challenge = await service.loginAdmin(actorEmail, password, {})
    assert.equal(challenge.status, 'mfa_setup_required')
    assert.ok('challengeToken' in challenge)
    const setup = await service.beginMfaSetup(challenge.challengeToken)
    const signed = await service.confirmMfaSetup(challenge.challengeToken, totp(setup.manualKey), {})
    assert.equal(signed.status, 'authenticated')
    assert.ok(signed.recoveryCodes.length)
    const next = await service.loginAdmin(actorEmail, password, {})
    assert.equal(next.status, 'mfa_required')
    assert.ok('challengeToken' in next)
    const verified = await service.verifyMfa(next.challengeToken, signed.recoveryCodes[0], {})
    await assert.rejects(service.verifyMfa(next.challengeToken, signed.recoveryCodes[0], {}), UnauthorizedException)
    const refreshed = await service.refresh(verified.refreshToken, {})
    const payload = jwt.verify(refreshed.accessToken, { secret: config.getOrThrow('JWT_ACCESS_SECRET') })
    await service.logout(actorId, payload.sid, {})
    await assert.rejects(service.refresh(refreshed.refreshToken, {}), UnauthorizedException)
    assert.ok(await db().authAuditEvent.count({ where: { userId: actorId, eventType: 'LOGIN_SUCCESS' } }))
  })

  it('reserva, troca assentos, recusa colisão e libera no cancelamento', async () => {
    const service = portal()
    const first = await service.requestReservation({ tripId, fullName: 'Synthetic client',
      email: clientEmail, phone: '85999999999', passengerCount: 1, selectedSeats: [1] })
    reservationId = first.reservation.id
    clientId = (await db().client.findUniqueOrThrow({ where: { email: clientEmail } })).id
    await service.updateClientSeats(clientId, reservationId, { selectedSeats: [2] })
    await assert.rejects(service.requestReservation({ tripId, fullName: 'Synthetic other',
      email: otherEmail, phone: '85888888888', passengerCount: 1, selectedSeats: [2] }), ConflictException)
    const other = await service.requestReservation({ tripId, fullName: 'Synthetic other',
      email: otherEmail, phone: '85888888888', passengerCount: 1, selectedSeats: [3] })
    await new AdminService(db()).cancelReservation(other.reservation.id, false, 'Synthetic cancellation', actorId)
    const map = await new TripsService(db()).findPublicSeatMap(tripId)
    assert.deepEqual(map.occupiedSeats, [2])
  })

  it('cotação, aprovação, parcelas, recebimento e estorno preservam a auditoria', async () => {
    assert.ok(reservationId)
    const commercial = new CommercialService(db())
    const quote = await commercial.createQuote({ reservationId, title: 'Synthetic quote' }, actorId)
    await commercial.addQuoteItem(quote.id, { category: QuoteItemCategory.OTHER,
      description: 'Synthetic service', quantity: 1, unitCostCents: 0, unitSaleCents: 10000 }, actorId)
    await commercial.sendQuote(quote.id, actorId)
    await portal().approveQuote(clientId, reservationId, quote.id)
    const plan = await commercial.createFinancePlan({ reservationId, installmentCount: 1,
      firstDueDate: new Date(Date.now() + 86400000) }, actorId)
    const admin = new AdminService(db())
    const paid = await admin.registerManualPayment(reservationId, { amountCents: 10000,
      method: ManualPaymentMethod.CASH, installmentId: plan.installments[0].id }, actorId)
    assert.equal(paid.summary.outstandingCents, 0)
    const payment = paid.manualPayments[0]
    const reversed = await admin.reverseManualPayment(reservationId, payment.id, 'Synthetic reversal', actorId)
    assert.equal(reversed.summary.outstandingCents, 10000)
    assert.equal(await db().manualPayment.count({ where: { id: payment.id } }), 1)
    assert.equal(await db().authAuditEvent.count({ where: { userId: actorId,
      eventType: { in: ['OPS_MANUAL_PAYMENT_RECEIVED', 'OPS_MANUAL_PAYMENT_REVERSED'] } } }), 2)
    await assert.rejects(db().authAuditEvent.deleteMany({ where: { userId: actorId } }))
    assert.equal(restrictedAuditWriter(await readDatabaseSecurityState(db())), true)
  })
})
