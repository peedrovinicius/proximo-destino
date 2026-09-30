import { Injectable, NotFoundException } from '@nestjs/common'
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

  list(query?: string) {
    const q = query?.trim()

    return this.prisma.client.findMany({
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
