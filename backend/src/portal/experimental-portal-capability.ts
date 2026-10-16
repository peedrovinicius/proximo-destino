import { UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { createHmac, randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'

// Experimental CI-only adapter. Not registered in a Nest module or controller.
// The signing key is a distinct backend trust boundary, NEVER the DB password.
// A SQL-only compromise of the API LOGIN must not be able to forge this proof.
export class ExperimentalPortalCapability {
  readonly #key: Buffer
  constructor(private readonly db: PrismaClient, key: Buffer) {
    if (process.env.NODE_ENV !== 'test' || key.length !== 32) {
      throw new Error('Disposable test adapter requires a synthetic 256-bit key')
    }
    this.#key = Buffer.from(key)
  }
  private proof(fields: Record<string, unknown>) {
    const payload = JSON.stringify({ v: 1, expires: Math.floor(Date.now() / 1000) + 20, ...fields })
    return { payload, signature: createHmac('sha256', this.#key).update(payload).digest('hex') }
  }
  private denied(): never { throw new UnauthorizedException('Acesso inválido ou indisponível') }
  async login(slug: string, input: { reservationId: string; email: string; code: string }) {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug) || input.reservationId.length > 128 ||
      input.email.length > 320 || !input.code.trim() || input.code.length > 128) this.denied()
    const request = this.proof({ op: 'lookup', nonce: randomBytes(32).toString('hex'),
      slug, reservationId: input.reservationId, email: input.email.trim().toLowerCase() })
    const [lookup] = await this.db.$queryRaw<Array<{ result: { challenge: string; codeHash: string; emailMatches: boolean } | null }>>`
      SELECT synth_portal_boundary.lookup(${request.payload}, ${request.signature}) AS result`
    if (!lookup?.result) this.denied()
    let valid = false
    try {
      // Always verify Argon2 before applying the email match, as the existing
      // portal does. Wrong email is a counted failed attempt, not an early exit.
      const codeValid = await argon2.verify(lookup.result.codeHash, input.code.trim().toUpperCase())
      valid = codeValid && lookup.result.emailMatches === true
    }
    catch { /* Malformed stored credentials must fail closed. */ }
    const completion = this.proof({ op: 'complete', challenge: lookup.result.challenge, valid })
    const [completed] = await this.db.$queryRaw<Array<{
      result: { accessToken: string; expiresAt: string; readOnly: true } | null
    }>>`SELECT synth_portal_boundary.complete(${completion.payload}, ${completion.signature}) AS result`
    if (!completed?.result) this.denied()
    return { ...completed.result, expiresAt: new Date(completed.result.expiresAt) }
  }
  async portal(slug: string, token: string) {
    const [row] = await this.db.$queryRaw<Array<{ result: {
      company: { slug: string; tradeName: string }; reservation: {
        status: string; passengerCount: number; trip: Record<string, unknown>; seats: number[]
      }; readOnly: true
    } | null }>>`SELECT synth_portal_boundary.session(${slug}, ${token}, false) AS result`
    if (!row?.result) this.denied()
    return row.result
  }
  async logout(slug: string, token: string) {
    const [row] = await this.db.$queryRaw<Array<{ result: { loggedOut: true } | null }>>`
      SELECT synth_portal_boundary.session(${slug}, ${token}, true) AS result`
    if (!row?.result) this.denied()
    return row.result
  }
}
