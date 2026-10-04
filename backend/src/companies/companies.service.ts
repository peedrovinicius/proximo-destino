import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCompanyDto } from './company.dto'

const fields = {
  id: true, slug: true, tradeName: true, legalName: true, registrationNumber: true,
  contactEmail: true, contactPhone: true, address: true, responsibleName: true,
  responsibleEmail: true, status: true, createdAt: true, updatedAt: true,
} as const

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.company.findMany({ select: fields, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 })
  }

  async create(actorId: string, body: CreateCompanyDto) {
    try {
      // Deliberately no user creation, membership, email, activation or legacy data reassignment.
      return await this.prisma.company.create({ data: {
        slug: body.slug, tradeName: body.tradeName, legalName: body.legalName,
        registrationNumber: body.registrationNumber, contactEmail: body.contactEmail,
        contactPhone: body.contactPhone, address: body.address,
        responsibleName: body.responsibleName, responsibleEmail: body.responsibleEmail,
        status: 'DRAFT', createdById: actorId,
      }, select: fields })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Identificador da empresa já cadastrado')
      }
      throw error
    }
  }

  async updateDraft(id: string, body: CreateCompanyDto) {
    try {
      // Status in the update predicate prevents races with a future activation workflow.
      return await this.prisma.company.update({ where: { id, status: 'DRAFT' }, data: {
        slug: body.slug, tradeName: body.tradeName, legalName: body.legalName ?? null,
        registrationNumber: body.registrationNumber ?? null, contactEmail: body.contactEmail,
        contactPhone: body.contactPhone ?? null, address: body.address ?? null,
        responsibleName: body.responsibleName, responsibleEmail: body.responsibleEmail,
      }, select: fields })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new NotFoundException('Rascunho de empresa não encontrado')
        if (error.code === 'P2002') throw new ConflictException('Identificador da empresa já cadastrado')
      }
      throw error
    }
  }
}
