import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { UserRole } from '@prisma/client'
import type { CookieOptions, Request, Response } from 'express'
import { AuthService } from './auth.service'
import type { RequestContext } from './auth.types'
import { LoginDto } from './dto/login.dto'
import { MfaChallengeDto, MfaVerifyDto } from './dto/mfa.dto'
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard'
import { Roles } from './roles.decorator'
import { RolesGuard } from './roles.guard'
import { OwnSessionAccess } from '../tenancy/company-access.decorator'
import { PasswordChangeDto } from './dto/password-change.dto'

const REFRESH_COOKIE = 'pd_refresh'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('admin/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async loginAdmin(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.loginAdmin(
      body.email,
      body.password,
      this.context(request),
    )
    return this.respondWithAuth(result, response)
  }

  @Post('creator/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async loginCreator(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respondWithAuth(await this.auth.loginCreator(
      body.email, body.password, this.context(request),
    ), response)
  }

  @Post('mfa/setup')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @HttpCode(200)
  setupMfa(@Body() body: MfaChallengeDto) {
    return this.auth.beginMfaSetup(body.challengeToken)
  }

  @Post('mfa/setup/verify')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @HttpCode(200)
  async verifyMfaSetup(
    @Body() body: MfaVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.confirmMfaSetup(
      body.challengeToken,
      body.code,
      this.context(request),
    )
    return this.respondWithAuth(result, response)
  }

  @Post('mfa/verify')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @HttpCode(200)
  async verifyMfa(
    @Body() body: MfaVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyMfa(
      body.challengeToken,
      body.code,
      this.context(request),
    )
    return this.respondWithAuth(result, response)
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.[REFRESH_COOKIE] as string | undefined
    if (!token) {
      throw new UnauthorizedException('Sessão ausente')
    }

    const result = await this.auth.refresh(token, this.context(request))
    return this.respondWithAuth(result, response)
  }

  @Post('logout')
  @OwnSessionAccess()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(
      request.user.id,
      request.user.sessionId,
      this.context(request),
    )
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions())
  }

  @Post('password/change') @OwnSessionAccess() @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Header('Cache-Control', 'no-store')
  async changePassword(@Body() body: PasswordChangeDto, @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.changePassword(request.user.id, request.user.sessionId, body.currentPassword, body.newPassword)
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions())
    return result
  }

  @Get('sessions')
  @OwnSessionAccess()
  @UseGuards(JwtAuthGuard)
  sessions(@Req() request: AuthenticatedRequest) {
    return this.auth.listSessions(request.user.id, request.user.sessionId)
  }

  @Delete('sessions/:sessionId')
  @OwnSessionAccess()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeSession(
      request.user.id,
      sessionId,
      this.context(request),
    )
    if (sessionId === request.user.sessionId) {
      response.clearCookie(REFRESH_COOKIE, this.cookieOptions())
    }
  }

  @Post('sessions/revoke-all')
  @OwnSessionAccess()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async revokeAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeAllSessions(request.user.id, this.context(request))
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions())
  }

  @Get('admin/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE)
  me(@Req() request: AuthenticatedRequest) {
    return request.user
  }

  private respondWithAuth(
    result:
      | Awaited<ReturnType<AuthService['loginAdmin']>>
      | Awaited<ReturnType<AuthService['confirmMfaSetup']>>
      | Awaited<ReturnType<AuthService['verifyMfa']>>
      | Awaited<ReturnType<AuthService['refresh']>>,
    response: Response,
  ) {
    if ('refreshToken' in result) {
      response.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions())
      const { refreshToken: _refreshToken, ...safe } = result
      return safe
    }
    return result
  }

  private context(request: Request): RequestContext {
    return {
      ip: request.ip,
      userAgent: request.get('user-agent') ?? undefined,
    }
  }

  private cookieOptions(): CookieOptions {
    const production = this.config.get<string>('NODE_ENV') === 'production'
    return {
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    }
  }
}
