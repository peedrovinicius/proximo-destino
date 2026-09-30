import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateClientDto } from './dto/create-client.dto'

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

  findById(id: string) {
    return this.prisma.client.findUnique({
      where: { id },
      include: {
        companions: true,
        reservations: {
          include: { trip: true },
          orderBy: { createdAt: 'desc' },
        },
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
