import { Body, Controller, Get, Header, Headers, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'
import { CompanyClientPortalService } from './company-client-portal.service'

export class CompanyClientPortalLoginDto {
  @IsString() @MinLength(1) @MaxLength(128) reservationId!: string
  @IsEmail() @MaxLength(254) email!: string
  @IsString() @MinLength(6) @MaxLength(128) code!: string
}
@Controller('public/companies/:slug/client')
export class CompanyClientPortalController {
  constructor(private readonly portalService: CompanyClientPortalService) {}
  @Post('login') @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Param('slug') slug: string, @Body() input: CompanyClientPortalLoginDto) { return this.portalService.login(slug, input) }
  @Get('portal') @Header('Cache-Control', 'no-store')
  portal(@Param('slug') slug: string, @Headers('authorization') authorization?: string) {
    return this.portalService.portal(slug, authorization?.startsWith('Bearer ') ? authorization.slice(7) : '')
  }
  @Post('logout') @Header('Cache-Control', 'no-store')
  logout(@Param('slug') slug: string, @Headers('authorization') authorization?: string) {
    return this.portalService.logout(slug, authorization?.startsWith('Bearer ') ? authorization.slice(7) : '')
  }
}
