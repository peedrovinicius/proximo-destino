import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CompaniesService } from '../companies/companies.service'

describe('company additive migration in isolated PostgreSQL', () => {
  const prisma = new PrismaService()
  const service = new CompaniesService(prisma)
  const suffix = randomUUID()
  const creatorId = `creator-${suffix}`
  const adminId = `company-admin-${suffix}`
  const ids: string[] = []
  let connected = false
  const fields = { tradeName: 'Synthetic company', slug: `synthetic-${suffix}`, contactEmail: 'contact@example.invalid',
    responsibleName: 'Synthetic responsible', responsibleEmail: 'responsible@example.invalid' }
  before(async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'http://missing')
    assert.equal(process.env.NODE_ENV, 'test', 'Requires isolated test environment')
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(database.hostname), 'Requires local test database')
    await prisma.$connect(); connected = true
    await prisma.user.createMany({ data: [
      { id: creatorId, email: `${creatorId}@example.invalid`, passwordHash: 'synthetic-unusable', role: 'CREATOR' },
      { id: adminId, email: `${adminId}@example.invalid`, passwordHash: 'synthetic-unusable', role: 'ADMIN' },
    ] })
  })
  after(async () => {
    if (!connected) return
    try {
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: ids } } })
      await prisma.company.deleteMany({ where: { createdById: creatorId } })
      await prisma.user.deleteMany({ where: { id: { in: [creatorId, adminId] } } })
    } finally { await prisma.$disconnect() }
  })
  it('persists only a draft and leaves responsible account unprovisioned', async () => {
    const company = await service.create(creatorId, fields); ids.push(company.id)
    assert.equal(company.status, 'DRAFT')
    assert.equal(await prisma.companyMembership.count({ where: { companyId: company.id } }), 0)
    assert.equal(await prisma.user.findUnique({ where: { email: fields.responsibleEmail } }), null)
  })
  it('enforces unique slug and preserves creator on edit', async () => {
    await assert.rejects(service.create(creatorId, fields), { status: 409 })
    await service.updateDraft(ids[0], { ...fields, tradeName: 'Synthetic revised' })
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: ids[0] } })).createdById, creatorId)
  })
  it('binds company membership through unique and foreign key constraints', async () => {
    await prisma.companyMembership.create({ data: { companyId: ids[0], userId: adminId, role: 'ADMIN' } })
    await assert.rejects(prisma.companyMembership.create({ data: { companyId: ids[0], userId: adminId, role: 'AGENT' } }), { code: 'P2002' })
    await assert.rejects(prisma.companyMembership.create({ data: { companyId: `missing-${suffix}`, userId: adminId, role: 'ADMIN' } }), { code: 'P2003' })
  })
  it('cannot edit active companies through the draft endpoint', async () => {
    // Synthetic database fixture only; no API activation route exists.
    await prisma.company.update({ where: { id: ids[0] }, data: { status: 'ACTIVE' } })
    await assert.rejects(service.updateDraft(ids[0], fields), { status: 404 })
  })
})
