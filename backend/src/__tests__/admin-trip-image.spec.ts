import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { TripStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TripsService } from '../trips/trips.service'

describe('imagens administráveis de viagem', () => {
  const prisma = new PrismaService()
  const trips = new TripsService(prisma)
  const suffix = randomUUID().slice(0, 8)
  const tripId = `trip-image-${suffix}`

  before(async () => {
    await prisma.$connect()
    await prisma.trip.create({
      data: {
        id: tripId,
        title: 'Viagem com foto',
        origin: 'Fortaleza',
        destination: 'Jericoacoara',
        departureDate: new Date(Date.now() + 3 * 86_400_000),
        status: TripStatus.SCHEDULED,
      },
    })
  })

  after(async () => {
    await prisma.trip.deleteMany({ where: { id: tripId } })
    await prisma.$disconnect()
  })

  it('salva imagem enviada e disponibiliza a mesma imagem publicamente', async () => {
    const source = Buffer.from('imagem-de-teste')

    const updated = await trips.uploadTripImage(tripId, {
      buffer: source,
      mimetype: 'image/webp',
      size: source.length,
    })

    assert.equal(updated.hasUploadedImage, true)
    assert.equal(updated.imageUrl, null)
    assert.ok(updated.imageUpdatedAt)

    const publicImage = await trips.publicTripImage(tripId)
    assert.equal(publicImage.mimeType, 'image/webp')
    assert.deepEqual(Buffer.from(publicImage.data), source)

    const publicTrip = await trips.findPublicById(tripId)
    assert.equal(publicTrip.hasUploadedImage, true)
  })

  it('troca upload por URL e remove os bytes antigos', async () => {
    const updated = await trips.update(tripId, {
      imageUrl: 'https://images.example.com/jericoacoara.jpg',
    })

    assert.equal(updated.hasUploadedImage, false)
    assert.equal(
      updated.imageUrl,
      'https://images.example.com/jericoacoara.jpg',
    )

    const stored = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        imageData: true,
        imageMimeType: true,
        imageUpdatedAt: true,
      },
    })

    assert.equal(stored?.imageData, null)
    assert.equal(stored?.imageMimeType, null)
    assert.equal(stored?.imageUpdatedAt, null)
  })

  it('rejeita arquivos que não são imagens permitidas', async () => {
    await assert.rejects(
      () =>
        trips.uploadTripImage(tripId, {
          buffer: Buffer.from('arquivo'),
          mimetype: 'application/pdf',
          size: 7,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes('JPG, PNG ou WebP'),
    )
  })
})
