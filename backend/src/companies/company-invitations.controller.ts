import { Body, Controller, ForbiddenException, Header, Post } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'
import { CompanyInvitationsService } from './company-invitations.service'

export class AcceptCompanyInviteDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string
  @IsString() @MinLength(16) @MaxLength(128)
  password!: string
}

export class OnboardingTokenDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/)
  onboardingToken!: string
}
export class OnboardingMfaDto extends OnboardingTokenDto {
  @IsString() @Matches(/^\d{6}$/)
  code!: string
}
export class ResumeOnboardingDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254)
  email!: string
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
    this.requireEnabled()
    return this.invitations.accept(body.token, body.password)
  }

  private requireEnabled() {
    if (this.config.get<string>('COMPANY_FOUNDATION_ENABLED') !== 'true') {
      throw new ForbiddenException('Cadastro de empresas ainda não habilitado')
    }
  }
  @Post('resume') @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resume(@Body() body: ResumeOnboardingDto) { this.requireEnabled(); return this.invitations.resume(body.email, body.password) }

  @Post('mfa/setup') @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setup(@Body() body: OnboardingTokenDto) { this.requireEnabled(); return this.invitations.beginMfa(body.onboardingToken) }

  @Post('mfa/confirm') @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  confirm(@Body() body: OnboardingMfaDto) { this.requireEnabled(); return this.invitations.confirmMfa(body.onboardingToken, body.code) }
}
