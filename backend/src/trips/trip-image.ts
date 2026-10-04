import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'

const MAX_BYTES = 2_500_000
const MAX_PIXELS = 16_000_000

type TripImageFile = { buffer: Buffer; mimetype: string; size: number }

export async function prepareTripImage(file?: TripImageFile) {
  if (!file) throw new BadRequestException('Selecione uma imagem para enviar')
  const formats: Record<string, string> = {
    'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
  }
  const format = formats[file.mimetype]
  if (!format) throw new BadRequestException('Envie uma imagem JPG, PNG ou WebP')
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length < 1 ||
      file.buffer.length > MAX_BYTES || file.size !== file.buffer.length) {
    throw new BadRequestException('A imagem deve ter no máximo 2,5 MB e tamanho válido')
  }
  const bytes = file.buffer
  const signatureMatches = format === 'jpeg'
    ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : format === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!signatureMatches) {
    throw new BadRequestException('O conteúdo do arquivo não corresponde à imagem informada')
  }
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_PIXELS })
    const metadata = await image.metadata()
    if (metadata.format !== format || !metadata.width || !metadata.height ||
        metadata.width * metadata.height > MAX_PIXELS || (metadata.pages ?? 1) > 1) {
      throw new Error('Unsupported image')
    }
    // Decode and re-encode; default sharp output strips EXIF and other metadata.
    const buffer = await image.rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
    if (buffer.length > MAX_BYTES) throw new Error('Output too large')
    return { buffer, mimetype: 'image/webp', size: buffer.length }
  } catch {
    throw new BadRequestException('Imagem inválida: use JPG, PNG ou WebP estático de até 16 megapixels')
  }
}
