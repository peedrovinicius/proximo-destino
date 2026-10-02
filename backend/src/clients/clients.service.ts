import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ClientCreditTransactionType } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateClientDto } from './dto/create-client.dto'
import { UpdateClientDto } from './dto/update-client.dto'

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        fullName: data.fullName.trim(),
        email: data.email?.trim().toLowerCase(),
        phone: data.phone?.trim(),
        birthDate: data.birthDate,
        document: data.document?.trim(),
        notes: data.notes?.trim(),
        companions: data.companions?.length
          ? {
              create: data.companions.map((companion) => ({
                fullName: companion.fullName.trim(),
                document: companion.document?.trim(),
                birthDate: companion.birthDate,
                relationship: companion.relationship?.trim(),
              })),
            }
          : undefined,
      },
      include: { companions: true },
    })
  }

  async list(query?: string) {
    const q = query?.trim()

    const clients = await this.prisma.client.findMany({
      where: q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        birthDate: true,
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
    return client
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

  async update(id: string, data: UpdateClientDto) {
    await this.findById(id)

    return this.prisma.client.update({
      where: { id },
      data: {
        fullName: data.fullName?.trim(),
        email: data.email?.trim().toLowerCase(),
        phone: data.phone?.trim(),
        birthDate: data.birthDate,
        document: data.document?.trim(),
        notes: data.notes?.trim(),
      },
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
