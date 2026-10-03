import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import {
  CancellationRequestStatus,
  PurchaseStatus,
  ReservationStatus,
  TripStatus,
  UserRole,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

type NotificationSeed = {
  type: string
  title: string
  message: string
  sourceKey: string
  actionTab: string
}

@Injectable()
export class AdminNotificationsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdminNotificationsService.name)
  private timer: NodeJS.Timeout | null = null
  private syncing = false

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return

    const first = setTimeout(() => void this.syncAllUsers(), 7_000)
    first.unref()

    this.timer = setInterval(() => void this.syncAllUsers(), 60_000)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async list(userId: string, limit = 80) {
    await this.syncUser(userId)

    const take = Math.min(Math.max(limit, 1), 100)
    const [items, unreadCount] = await Promise.all([
      this.prisma.adminNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          actionTab: true,
          isRead: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.adminNotification.count({
        where: { userId, isRead: false },
      }),
    ])

    return { unreadCount, items }
  }

  async markRead(userId: string, notificationId: string) {
    const updated = await this.prisma.adminNotification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    })

    if (!updated.count) {
      throw new NotFoundException('Notificação não encontrada')
    }

    return this.prisma.adminNotification.findFirstOrThrow({
      where: { id: notificationId, userId },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        actionTab: true,
        isRead: true,
        readAt: true,
        createdAt: true,
      },
    })
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.adminNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })

    return { updated: result.count }
  }

  async syncUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    })

    if (!user?.isActive || user.role === UserRole.CLIENT) {
      return { created: 0 }
    }

    const seeds = await this.buildSeeds(user.role)
    if (!seeds.length) return { created: 0 }

    const result = await this.prisma.adminNotification.createMany({
      data: seeds.map((seed) => ({
        userId,
        ...seed,
      })),
      skipDuplicates: true,
    })

    return { created: result.count }
  }

  private async syncAllUsers() {
    if (this.syncing) return
    this.syncing = true

    try {
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: [UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE] },
        },
        select: { id: true },
      })

      for (const user of users) {
        await this.syncUser(user.id)
      }
    } catch (error) {
      this.logger.error(
        'Falha ao sincronizar notificações administrativas',
        error instanceof Error ? error.stack : String(error),
      )
    } finally {
      this.syncing = false
    }
  }

  private async buildSeeds(role: UserRole): Promise<NotificationSeed[]> {
    const seeds: NotificationSeed[] = []
    const now = new Date()
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86_400_000)

    if (role === UserRole.ADMIN || role === UserRole.AGENT) {
      const [pendingReservations, upcomingTrips] = await Promise.all([
        this.prisma.reservation.findMany({
          where: { status: ReservationStatus.PENDING },
          select: {
            id: true,
            createdAt: true,
            client: { select: { fullName: true } },
            trip: {
              select: { title: true, departureDate: true },
            },
          },
          orderBy: { createdAt: 'asc' },
          take: 200,
        }),
        this.prisma.trip.findMany({
          where: {
            status: { in: [TripStatus.SCHEDULED, TripStatus.ACTIVE] },
            departureDate: { gte: now, lte: sevenDaysFromNow },
          },
          select: {
            id: true,
            title: true,
            departureDate: true,
            origin: true,
            destination: true,
          },
          orderBy: { departureDate: 'asc' },
          take: 100,
        }),
      ])

      for (const reservation of pendingReservations) {
        seeds.push({
          type: 'RESERVATION_PENDING',
          title: 'Nova reserva aguardando análise',
          message:
            `${reservation.client.fullName} aguarda atendimento para ${reservation.trip.title}.`,
          sourceKey: `reservation-pending:${reservation.id}`,
          actionTab: 'reservations',
        })
      }

      for (const trip of upcomingTrips) {
        seeds.push({
          type: 'TRIP_UPCOMING',
          title: 'Viagem próxima',
          message:
            `${trip.title} sai em ${this.formatDateTime(trip.departureDate)} · ${trip.origin} → ${trip.destination}.`,
          sourceKey: `trip-upcoming:${trip.id}:${trip.departureDate.toISOString()}`,
          actionTab: 'trips',
        })
      }

      const birthdaySeeds = await this.birthdaySeeds(now)
      seeds.push(...birthdaySeeds)
    }

    if (role === UserRole.ADMIN) {
      const cancellations = await this.prisma.reservation.findMany({
        where: {
          cancellationRequestStatus: CancellationRequestStatus.PENDING,
          cancellationRequestedAt: { not: null },
        },
        select: {
          id: true,
          cancellationRequestedAt: true,
          cancellationRequestReason: true,
          client: { select: { fullName: true } },
          trip: { select: { title: true } },
        },
        orderBy: { cancellationRequestedAt: 'asc' },
        take: 100,
      })

      for (const reservation of cancellations) {
        if (!reservation.cancellationRequestedAt) continue
        seeds.push({
          type: 'CANCELLATION_REQUEST',
          title: 'Cancelamento solicitado',
          message:
            `${reservation.client.fullName} solicitou cancelamento de ${reservation.trip.title}` +
            (reservation.cancellationRequestReason
              ? `: ${reservation.cancellationRequestReason}`
              : '.'),
          sourceKey:
            `cancellation-request:${reservation.id}:` +
            reservation.cancellationRequestedAt.toISOString(),
          actionTab: 'reservations',
        })
      }
    }

    if (role === UserRole.ADMIN || role === UserRole.FINANCE) {
      const pendingPayments = await this.prisma.purchaseOrder.findMany({
        where: { status: PurchaseStatus.PENDING_PAYMENT },
        select: {
          id: true,
          totalCents: true,
          createdAt: true,
          reservation: {
            select: {
              client: { select: { fullName: true } },
              trip: { select: { title: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })

      for (const order of pendingPayments) {
        seeds.push({
          type: 'PAYMENT_PENDING',
          title: 'Pagamento aguardando confirmação',
          message:
            `${order.reservation.client.fullName} · ${order.reservation.trip.title} · ${this.formatMoney(order.totalCents)}.`,
          sourceKey: `payment-pending:${order.id}`,
          actionTab: 'payments',
        })
      }
    }

    return seeds
  }

  private async birthdaySeeds(now: Date): Promise<NotificationSeed[]> {
    const today = this.fortalezaParts(now)
    const clients = await this.prisma.client.findMany({
      where: { birthDate: { not: null } },
      select: {
        id: true,
        fullName: true,
        birthDate: true,
      },
      take: 5_000,
    })

    const seeds: NotificationSeed[] = []

    for (const client of clients) {
      if (!client.birthDate) continue

      const month = client.birthDate.getUTCMonth() + 1
      const day = client.birthDate.getUTCDate()

      let next = new Date(Date.UTC(today.year, month - 1, day, 12))
      const todayUtc = Date.UTC(today.year, today.month - 1, today.day, 12)

      if (next.getTime() < todayUtc) {
        next = new Date(Date.UTC(today.year + 1, month - 1, day, 12))
      }

      const daysUntil = Math.round((next.getTime() - todayUtc) / 86_400_000)
      if (daysUntil < 0 || daysUntil > 7) continue

      const birthdayYear = next.getUTCFullYear()
      seeds.push({
        type: 'BIRTHDAY',
        title: daysUntil === 0 ? 'Aniversário hoje' : 'Aniversário próximo',
        message:
          daysUntil === 0
            ? `${client.fullName} faz aniversário hoje.`
            : `${client.fullName} faz aniversário em ${daysUntil} dia(s).`,
        sourceKey: `birthday:${client.id}:${birthdayYear}`,
        actionTab: 'clients',
      })
    }

    return seeds
  }

  private formatDateTime(value: Date) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(value)
  }

  private formatMoney(cents: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100)
  }

  private fortalezaParts(value: Date) {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Fortaleza',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(value)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )

    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
    }
  }
}
