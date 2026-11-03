import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { CreateClientDto, CreateCompanionDto } from '../clients/dto/create-client.dto'
import { UpdateClientDto } from '../clients/dto/update-client.dto'
import { UpdateCompanionDto } from '../clients/dto/update-companion.dto'
import { encryptedDocumentFields, hashSensitive } from '../security/sensitive-data'
import { lockCompanyWrite } from './company-write-lock'

const fields = { id: true, fullName: true, email: true, phone: true, birthDate: true } as const

function cpf(value: string | undefined) {
  if (!value?.trim()) return null
  if (!/^[\d.\-\s]+$/.test(value)) throw new BadRequestException('CPF inválido')
  const digits = value.replace(/\D/g, '')
  const check = (size: number) => {
    const total = [...digits.slice(0, size)].reduce((sum, char, index) => sum + Number(char) * (size + 1 - index), 0)
    return ((total * 10) % 11) % 10
  }
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits) || check(9) !== Number(digits[9]) || check(10) !== Number(digits[10])) {
    throw new BadRequestException('CPF inválido')
  }
  return digits
}

@Injectable()
export class CompanyClientsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: CompanyScopeService) {}

  async create(userId: string, sessionId: string, data: CreateClientDto) {
    return this.write(userId, sessionId, data, undefined, data.companions)
  }

  async update(userId: string, sessionId: string, id: string, data: UpdateClientDto) {
    return this.write(userId, sessionId, data, id)
  }

  async createCompanion(userId: string, sessionId: string, clientId: string, data: CreateCompanionDto) {
    return this.writeCompanion(userId, sessionId, clientId, data)
  }

  async updateCompanion(userId: string, sessionId: string, clientId: string, id: string, data: UpdateCompanionDto) {
    return this.writeCompanion(userId, sessionId, clientId, data, id)
  }

  private async writeCompanion(userId: string, sessionId: string, clientId: string, data: UpdateCompanionDto, id?: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de clientes')
    if ((!id || data.fullName !== undefined) && (typeof data.fullName !== 'string' || data.fullName.trim().length < 2)) {
      throw new BadRequestException('Informe o nome do acompanhante com pelo menos 2 caracteres')
    }
    return this.prisma.$transaction(async tx => {
      await lockCompanyWrite(tx, scope)
      // Lock the parent against reassignment and serialize the per-client limit.
      const parent = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Client" WHERE "id" = ${clientId} AND "companyId" = ${scope.companyId} FOR UPDATE`
      if (!parent.length) throw new NotFoundException('Cliente não encontrado')
      if (id && !await tx.companion.findFirst({ where: { id, clientId }, select: { id: true } })) {
        throw new NotFoundException('Acompanhante não encontrado')
      }
      if (!id && await tx.companion.count({ where: { clientId } }) >= 80) {
        throw new ConflictException('Limite de 80 acompanhantes por cliente atingido')
      }
      const values = { fullName: data.fullName?.trim(), birthDate: data.birthDate,
        relationship: data.relationship === undefined ? undefined : data.relationship?.trim() || null,
        ...(data.document !== undefined ? encryptedDocumentFields(data.document?.trim() || null) : {}) }
      const select = { id: true, fullName: true, birthDate: true, relationship: true } as const
      const result = id
        ? await tx.companion.update({ where: { id, clientId }, data: values, select })
        : await tx.companion.create({ data: { ...values, clientId, fullName: data.fullName!.trim() }, select })
      await tx.authAuditEvent.create({ data: { userId,
        eventType: id ? 'OPS_COMPANY_COMPANION_UPDATED' : 'OPS_COMPANY_COMPANION_CREATED',
        metadata: { companyId: scope.companyId, clientId, companionId: result.id,
          fields: Object.keys(data).filter(key => data[key as keyof UpdateCompanionDto] !== undefined) } } })
      return result
    })
  }

  private async write(userId: string, sessionId: string, data: UpdateClientDto, id?: string, companions?: CreateCompanionDto[]) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de clientes')
    if ((!id || data.fullName !== undefined) && (!data.fullName?.trim() || data.fullName.trim().length < 2)) {
      throw new BadRequestException('Informe o nome do cliente com pelo menos 2 caracteres')
    }
    if (companions !== undefined && (!Array.isArray(companions) || companions.length > 80 ||
      companions.some(c => !c || typeof c.fullName !== 'string' || c.fullName.trim().length < 2))) {
      throw new BadRequestException('Informe até 80 acompanhantes com nomes válidos')
    }
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCompanyWrite(tx, scope)
        if (id && !await tx.client.findFirst({ where: { id, companyId: scope.companyId }, select: { id: true } })) {
          throw new NotFoundException('Cliente não encontrado')
        }
        const document = data.document === undefined ? undefined : cpf(data.document)
        if (document && await tx.client.findFirst({ where: { companyId: scope.companyId,
          ...(id ? { id: { not: id } } : {}), OR: [{ documentHash: hashSensitive(document) }, { document }] }, select: { id: true } })) {
          throw new ConflictException('CPF já cadastrado nesta empresa')
        }
        const values = { fullName: data.fullName?.trim(), email: data.email?.trim().toLowerCase(),
          phone: data.phone?.trim(), birthDate: data.birthDate, notes: data.notes?.trim(),
          ...(data.document !== undefined ? encryptedDocumentFields(document) : {}) }
        const client = id
          ? await tx.client.update({ where: { id, companyId: scope.companyId }, data: values, select: fields })
          : await tx.client.create({ data: { ...values, fullName: data.fullName!.trim(), companyId: scope.companyId,
            // Parent ownership is generated by the server. No submitted IDs
            // are reused or connected to another client's companions.
            companions: companions?.length ? { create: companions.map(c => ({ fullName: c.fullName.trim(),
              birthDate: c.birthDate, relationship: c.relationship?.trim(),
              ...encryptedDocumentFields(c.document?.trim() || null) })) } : undefined,
          }, select: fields })
        await tx.authAuditEvent.create({ data: { userId, eventType: id ? 'OPS_COMPANY_CLIENT_UPDATED' : 'OPS_COMPANY_CLIENT_CREATED',
          metadata: { companyId: scope.companyId, clientId: client.id,
            ...(!id ? { companionCount: companions?.length ?? 0 } : {}),
            fields: Object.keys(data).filter(key => data[key as keyof UpdateClientDto] !== undefined) } } })
        return client
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new NotFoundException('Cliente não encontrado')
        if (error.code === 'P2002') throw new ConflictException('Cadastro indisponível para os dados informados')
      }
      throw error
    }
  }
}
