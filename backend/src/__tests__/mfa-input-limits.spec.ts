import 'reflect-metadata'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ValidationPipe } from '@nestjs/common'
import { MfaChallengeDto, MfaVerifyDto } from '../auth/dto/mfa.dto'

describe('limites de entrada do desafio MFA', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })

  it('rejeita tokens excessivos nas três operações MFA antes de chamar o serviço', async () => {
    for (const metatype of [MfaChallengeDto, MfaVerifyDto]) {
      const body = metatype === MfaVerifyDto
        ? { challengeToken: 'a'.repeat(2049), code: '123456' }
        : { challengeToken: 'a'.repeat(2049) }
      await assert.rejects(pipe.transform(body, { type: 'body', metatype }),
        (error: Error) => error.message === 'Bad Request Exception')
    }
  })

  it('preserva os limites existentes e aceita desafios dentro do teto', async () => {
    for (const length of [20, 2048]) {
      const input = { challengeToken: 'a'.repeat(length), code: '123456' }
      const result = await pipe.transform(input, { type: 'body', metatype: MfaVerifyDto })
      assert.equal(result.challengeToken, input.challengeToken)
    }
    await assert.rejects(pipe.transform({ challengeToken: 'a'.repeat(19) },
      { type: 'body', metatype: MfaChallengeDto }))
    await assert.rejects(pipe.transform({ challengeToken: 'a'.repeat(20), unexpected: true },
      { type: 'body', metatype: MfaChallengeDto }))
  })
})
