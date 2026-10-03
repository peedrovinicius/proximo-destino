import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ClientCreditTransactionType } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  encryptedDocumentFields,
  hashSensitive,
  revealDocument,
} from '../security/sensitive-data'
import { CreateClientDto } from './dto/create-client.dto'
import { UpdateClientDto } from './dto/update-client.dto'

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeCpf(value?: string | null) {
    const digits = value?.replace(/\D/g, '') ?? ''
    return digits || undefined
  }

  private isValidCpf(value: string) {
    if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) {
      return false
    }

    const digit = (base: string, factor: number) => {
      let total = 0
      for (const char of base) {
        total += Number(char) * factor
        factor -= 1
      }
      const remainder = (total * 10) % 11
      return remainder === 10 ? 0 : remainder
    }

    return (
      digit(value.slice(0, 9), 10) === Number(value[9]) &&
      digit(value.slice(0, 10), 11) === Number(value[10])
    )
  }

  private async validateCpf(
    value?: string | null,
    excludeClientId?: string,
  ) {
    const cpf = this.normalizeCpf(value)
    if (!cpf) return undefined

    if (!this.isValidCpf(cpf)) {
      throw new BadRequestException('CPF inválido')
    }

    const duplicate = await this.prisma.client.findFirst({
      where: {
        OR: [
          { documentHash: hashSensitive(cpf) ?? undefined },
          { document: cpf },
        ],
        ...(excludeClientId ? { id: { not: excludeClientId } } : {}),
      },
      select: { id: true },
    })

    if (duplicate) {
      throw new BadRequestException('Este CPF já está cadastrado')
    }

    return cpf
  }

  async create(data: CreateClientDto, actorUserId?: string) {
    const cpf = await this.validateCpf(data.document)

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          fullName: data.fullName.trim(),
          email: data.email?.trim().toLowerCase(),
          phone: data.phone?.trim(),
          birthDate: data.birthDate,
          ...encryptedDocumentFields(cpf),
          notes: data.notes?.trim(),
          companions: data.companions?.length
            ? {
                create: data.companions.map((companion) => ({
                  fullName: companion.fullName.trim(),
                  ...encryptedDocumentFields(
                    companion.document?.trim() || null,
                  ),
                  birthDate: companion.birthDate,
                  relationship: companion.relationship?.trim(),
                })),
              }
            : undefined,
        },
        include: { companions: true },
      })

      if (actorUserId) {
        await tx.authAuditEvent.create({
          data: {
            userId: actorUserId,
            eventType: 'OPS_CLIENT_CREATED',
            metadata: {
              clientId: client.id,
              fields: [
                'fullName',
                ...(data.email ? ['email'] : []),
                ...(data.phone ? ['phone'] : []),
                ...(data.birthDate ? ['birthDate'] : []),
                ...(data.document ? ['document'] : []),
                ...(data.notes ? ['notes'] : []),
              ],
              companionCount: client.companions.length,
            },
          },
        })
      }

      return client
    })
  }

  async list(query?: string) {
    const q = query?.trim()
    const documentQuery = q?.replace(/\D/g, '')

    const clients = await this.prisma.client.findMany({
      where: q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              ...(documentQuery.length === 11
                ? [
                    {
                      documentHash:
                        hashSensitive(documentQuery) ?? undefined,
                    },
                    { document: documentQuery },
                  ]
                : []),
            ],
          }
        : undefined,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        birthDate: true,
        document: true,
        documentEncrypted: true,
        createdAt: true,
        _count: { select: { companions: true, reservations: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    if (!clients.length) return []

    const balances = await this.prisma.clientCreditTransaction.groupBy({
      by: ['clientId'],
      where: { clientId: { in: clients.map((client) => client.id) } },
      _sum: { amountCents: true },
    })
    const byClient = new Map(
      balances.map((entry) => [entry.clientId, entry._sum.amountCents ?? 0]),
    )

    return clients.map((client) => ({
      ...client,
      document: revealDocument(client),
      documentEncrypted: undefined,
      bonusBalanceCents: Math.max(0, byClient.get(client.id) ?? 0),
    }))
  }

  async findById(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        companions: true,
        reservations: {
          select: {
            id: true,
            status: true,
            passengerCount: true,
            seatAssignments: {
              select: { seatNumber: true },
              orderBy: { seatNumber: 'asc' },
            },
            createdAt: true,
            trip: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!client) throw new NotFoundException('Cliente não encontrado')
    return {
      ...client,
      document: revealDocument(client),
      documentEncrypted: undefined,
      companions: client.companions.map((companion) => ({
        ...companion,
        document: revealDocument(companion),
        documentEncrypted: undefined,
      })),
    }
  }

  async credits(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      select: { id: true, fullName: true },
    })
    if (!client) throw new NotFoundException('Cliente não encontrado')

    const transactions = await this.prisma.clientCreditTransaction.findMany({
      where: { clientId: id },
      select: {
        id: true,
        type: true,
        amountCents: true,
        note: true,
        createdAt: true,
        reservation: {
          select: {
            id: true,
            trip: { select: { title: true, destination: true } },
          },
        },
        actor: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const balanceCents = transactions.reduce(
      (sum, transaction) => sum + transaction.amountCents,
      0,
    )

    return {
      client,
      balanceCents: Math.max(0, balanceCents),
      transactions,
    }
  }

  async removeBonus(
    id: string,
    amountCents: number,
    reason: string | undefined,
    actorUserId: string,
  ) {
    const current = await this.credits(id)
    if (amountCents > current.balanceCents) {
      throw new BadRequestException('O valor supera o saldo de bônus disponível')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.clientCreditTransaction.create({
        data: {
          clientId: id,
          type: ClientCreditTransactionType.BONUS_REMOVED,
          amountCents: -amountCents,
          note: reason?.trim() || 'Retirada manual de bônus pelo Admin',
          actorUserId,
        },
      })
      await tx.authAuditEvent.create({
        data: {
          userId: actorUserId,
          eventType: 'OPS_CLIENT_BONUS_REMOVED',
          metadata: {
            clientId: id,
            amountCents,
            reason: reason?.trim() || null,
          },
        },
      })
    })

    return this.credits(id)
  }

  async update(
    id: string,
    data: UpdateClientDto,
    actorUserId?: string,
  ) {
    await this.findById(id)

    const cpf =
      data.document === undefined
        ? undefined
        : await this.validateCpf(data.document, id)

    const changedFields = Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id },
        data: {
          fullName: data.fullName?.trim(),
          email: data.email?.trim().toLowerCase(),
          phone: data.phone?.trim(),
          birthDate: data.birthDate,
          ...(data.document !== undefined
            ? encryptedDocumentFields(cpf ?? null)
            : {}),
          notes: data.notes?.trim(),
        },
      })

      if (actorUserId && changedFields.length) {
        await tx.authAuditEvent.create({
          data: {
            userId: actorUserId,
            eventType: 'OPS_CLIENT_UPDATED',
            metadata: {
              clientId: id,
              changedFields,
            },
          },
        })
      }

      return client
    })
  }

  listBirthdays() {
    return this.prisma.client.findMany({
      where: { birthDate: { not: null } },
      select: {
        id: true,
        fullName: true,
        phone: true,
        birthDate: true,
      },
      orderBy: { fullName: 'asc' },
    })
  }
}
