import { Body, Controller, ForbiddenException, Header, Post } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { CompanyInvitationsService } from './company-invitations.service'

export class AcceptCompanyInviteDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string
  @IsString() @MinLength(16) @MaxLength(128)
  password!: string
}

@Controller('company-invitations')
export class CompanyInvitationsController {
  constructor(private readonly invitations: CompanyInvitationsService, private readonly config: ConfigService) {}
  @Post('accept')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  accept(@Body() body: AcceptCompanyInviteDto) {
    if (this.config.get<string>('COMPANY_FOUNDATION_ENABLED') !== 'true') {
      throw new ForbiddenException('Cadastro de empresas ainda não habilitado')
    }
    return this.invitations.accept(body.token, body.password)
  }
}
