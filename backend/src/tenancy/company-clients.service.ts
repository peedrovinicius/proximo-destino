import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CompanyScopeService } from './company-scope.service'
import { CreateClientDto } from '../clients/dto/create-client.dto'
import { UpdateClientDto } from '../clients/dto/update-client.dto'
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
    if (data.companions?.length) throw new BadRequestException('Cadastro de acompanhantes ainda não habilitado para empresas')
    return this.write(userId, sessionId, data)
  }

  async update(userId: string, sessionId: string, id: string, data: UpdateClientDto) {
    return this.write(userId, sessionId, data, id)
  }

  private async write(userId: string, sessionId: string, data: UpdateClientDto, id?: string) {
    const scope = await this.scopes.resolveSession(userId, sessionId)
    if (scope.role === 'FINANCE') throw new ForbiddenException('Perfil sem acesso ao cadastro de clientes')
    if ((!id || data.fullName !== undefined) && (!data.fullName?.trim() || data.fullName.trim().length < 2)) {
      throw new BadRequestException('Informe o nome do cliente com pelo menos 2 caracteres')
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
          : await tx.client.create({ data: { ...values, fullName: data.fullName!.trim(), companyId: scope.companyId }, select: fields })
        await tx.authAuditEvent.create({ data: { userId, eventType: id ? 'OPS_COMPANY_CLIENT_UPDATED' : 'OPS_COMPANY_CLIENT_CREATED',
          metadata: { companyId: scope.companyId, clientId: client.id,
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
