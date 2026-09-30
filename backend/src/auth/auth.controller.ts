import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { UserRole } from '@prisma/client'
import type { CookieOptions, Request, Response } from 'express'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard'
import { Roles } from './roles.decorator'
import { RolesGuard } from './roles.guard'

const REFRESH_COOKIE = 'pd_refresh'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('admin/login')
  @HttpCode(200)
  async loginAdmin(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.loginAdmin(body.email, body.password)
    response.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions())

    return {
      accessToken: result.accessToken,
      user: result.user,
    }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.[REFRESH_COOKIE] as string | undefined
    if (!token) {
      throw new UnauthorizedException('Sessão ausente')
    }

    const result = await this.auth.refresh(token)
    response.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions())

    return {
      accessToken: result.accessToken,
      user: result.user,
    }
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revoke(request.user.id)
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions())
  }

  @Get('admin/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE)
  me(@Req() request: AuthenticatedRequest) {
    return request.user
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
