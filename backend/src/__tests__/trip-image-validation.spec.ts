import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'
import { prepareTripImage } from '../trips/trip-image'

const options = { create: { width: 2, height: 2, channels: 3 as const, background: '#123456' } }
const upload = (buffer: Buffer, mimetype: string) => ({ buffer, mimetype, size: buffer.length })

describe('validação de bytes das fotos de viagem', () => {
  it('decodifica JPG, PNG e WebP e persiste WebP estático sem EXIF', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const input = await sharp(options).toFormat(format)
        .withMetadata({ exif: { IFD0: { Artist: 'private-test-metadata' } } }).toBuffer()
      const result = await prepareTripImage(upload(input, `image/${format}`))
      const metadata = await sharp(result.buffer).metadata()
      assert.equal(result.mimetype, 'image/webp')
      assert.equal(metadata.format, 'webp')
      assert.equal(metadata.width, 2)
      assert.equal(metadata.height, 2)
      assert.equal(metadata.exif, undefined)
    }
  })

  it('rejeita MIME forjado, formato diferente e imagem truncada', async () => {
    const png = await sharp(options).png().toBuffer()
    for (const file of [upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/png'),
      upload(png, 'image/jpeg'), upload(png.subarray(0, 24), 'image/png'),
      upload(Buffer.from('imagem-de-teste'), 'image/webp')]) {
      await assert.rejects(() => prepareTripImage(file), BadRequestException)
    }
  })

  it('rejeita tamanho informado falso, arquivo vazio e mais de 2,5 MB', async () => {
    const png = await sharp(options).png().toBuffer()
    for (const file of [{ ...upload(png, 'image/png'), size: 1 },
      upload(Buffer.alloc(0), 'image/png'), upload(Buffer.alloc(2_500_001), 'image/png')]) {
      await assert.rejects(() => prepareTripImage(file), BadRequestException)
    }
  })

  it('rejeita uma imagem pequena em bytes que excede o limite de pixels', async () => {
    const compressed = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    assert.ok(compressed.length < 2_500_000)
    await assert.rejects(() => prepareTripImage(upload(compressed, 'image/png')), BadRequestException)
  })
})
