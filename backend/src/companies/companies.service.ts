import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCompanyDto, CreateCompanyAdminDto } from './company.dto'
import argon2 from 'argon2'
import { lockCreatorWrite } from './creator-write-lock'

const fields = {
  id: true, slug: true, tradeName: true, legalName: true, registrationNumber: true,
  contactEmail: true, contactPhone: true, address: true, responsibleName: true,
  responsibleEmail: true, status: true, createdAt: true, updatedAt: true,
} as const

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id }, select: {
      status: true, memberships: { where: { role: 'ADMIN' }, select: { isActive: true,
        user: { select: { isActive: true, mfaEnabled: true } } } },
    } })
    if (!company) throw new NotFoundException('Empresa não encontrada')
    // Informational only. No feature flag or submitted status can bypass these gates.
    return { companyId: id, status: company.status, activationAllowed: false,
      administrators: { total: company.memberships.length,
        activeWithMfa: company.memberships.filter(m => m.isActive && m.user.isActive && m.user.mfaEnabled).length },
      blockers: ['TENANT_ISOLATION_INCOMPLETE', 'SECURE_ADMIN_ONBOARDING_REQUIRED',
        'PRODUCTION_BACKFILL_AND_ACCEPTANCE_REQUIRED'],
    }
  }

  async admins(companyId: string) {
    if (!await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })) {
      throw new NotFoundException('Empresa não encontrada')
    }
    return this.prisma.companyMembership.findMany({ where: { companyId, role: 'ADMIN' },
      select: { id: true, isActive: true, inviteUsedAt: true, inviteExpiresAt: true, user: { select: {
        id: true, displayName: true, email: true, isActive: true,
      } } }, orderBy: { createdAt: 'desc' }, take: 100 })
  }

  async createPendingAdmin(actorId: string, sessionId: string, companyId: string, body: CreateCompanyAdminDto) {
    const email = body.email.trim().toLowerCase()
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id })
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCreatorWrite(tx, actorId, sessionId)
        // Serialize against company status changes; never provision onto an active company.
        const company = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Company" WHERE "id" = ${companyId} AND "status" = 'DRAFT' FOR UPDATE`
        if (!company.length) throw new NotFoundException('Rascunho de empresa não encontrado')
        // Do not reuse/promote an existing account (including case variants from legacy data).
        if (await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) {
          throw new ConflictException('E-mail já vinculado a uma conta; nenhuma conta existente foi alterada')
        }
        const user = await tx.user.create({ data: { email, displayName: body.displayName,
          passwordHash, role: 'ADMIN', isActive: false, companyManaged: true },
          select: { id: true, displayName: true, email: true, isActive: true } })
        const membership = await tx.companyMembership.create({ data: {
          companyId, userId: user.id, role: 'ADMIN', isActive: false,
        }, select: { id: true, isActive: true } })
        await tx.authAuditEvent.create({ data: { userId: actorId, eventType: 'PLATFORM_COMPANY_ADMIN_CREATED',
          metadata: { companyId, targetUserId: user.id, membershipId: membership.id } } })
        return { ...membership, user }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('E-mail já vinculado a uma conta; nenhuma conta existente foi alterada')
      }
      throw error
    }
  }

  list() {
    return this.prisma.company.findMany({ select: fields, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 })
  }

  async create(actorId: string, sessionId: string, body: CreateCompanyDto) {
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCreatorWrite(tx, actorId, sessionId)
        const company = await tx.company.create({ data: {
          slug: body.slug, tradeName: body.tradeName, legalName: body.legalName,
          registrationNumber: body.registrationNumber, contactEmail: body.contactEmail,
          contactPhone: body.contactPhone, address: body.address,
          responsibleName: body.responsibleName, responsibleEmail: body.responsibleEmail,
          status: 'DRAFT', createdById: actorId,
        }, select: fields })
        await tx.authAuditEvent.create({ data: { userId: actorId, eventType: 'PLATFORM_COMPANY_CREATED',
          metadata: { companyId: company.id } } })
        return company
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Identificador da empresa já cadastrado')
      }
      throw error
    }
  }

  async updateDraft(actorId: string, sessionId: string, id: string, body: CreateCompanyDto) {
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCreatorWrite(tx, actorId, sessionId)
        const company = await tx.company.update({ where: { id, status: 'DRAFT' }, data: {
          slug: body.slug, tradeName: body.tradeName, legalName: body.legalName ?? null,
          registrationNumber: body.registrationNumber ?? null, contactEmail: body.contactEmail,
          contactPhone: body.contactPhone ?? null, address: body.address ?? null,
          responsibleName: body.responsibleName, responsibleEmail: body.responsibleEmail,
        }, select: fields })
        await tx.authAuditEvent.create({ data: { userId: actorId, eventType: 'PLATFORM_COMPANY_UPDATED',
          metadata: { companyId: company.id, fields: Object.keys(body) } } })
        return company
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new NotFoundException('Rascunho de empresa não encontrado')
        if (error.code === 'P2002') throw new ConflictException('Identificador da empresa já cadastrado')
      }
      throw error
    }
  }
}
