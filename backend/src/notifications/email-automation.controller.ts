import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard'
import { ADMIN_ONLY_ROLES } from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import {
  ConnectEmailProviderDto,
  UpdateEmailAutomationDto,
  UpdateEmailProviderSettingsDto,
} from './dto/email-provider.dto'
import { EmailAutomationService } from './email-automation.service'

@Controller('admin/notifications/email')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY_ROLES)
export class EmailAutomationController {
  constructor(private readonly email: EmailAutomationService) {}

  @Get('status')
  status() {
    return this.email.status()
  }

  @Post('oauth/connect')
  oauthConnect(@Req() request: AuthenticatedRequest) {
    return this.email.beginOAuth(request.user.id)
  }

  @Patch('connection/settings')
  updateSettings(
    @Body() body: UpdateEmailProviderSettingsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.email.updateProviderSettings(
      body,
      request.user.id,
    )
  }

  @Post('connection')
  connect(
    @Body() body: ConnectEmailProviderDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.email.connectProvider(body, request.user.id)
  }

  @Delete('connection')
  disconnect(@Req() request: AuthenticatedRequest) {
    return this.email.disconnectProvider(request.user.id)
  }

  @Patch('automation')
  automation(
    @Body() body: UpdateEmailAutomationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.email.setAutomationEnabled(
      body.enabled,
      request.user.id,
    )
  }

  @Get('outbox')
  outbox(@Query('limit') limit = '50') {
    const parsed = Number.parseInt(limit, 10)
    return this.email.recent(Number.isFinite(parsed) ? parsed : 50)
  }

  @Post('process')
  process() {
    return this.email.processNow()
  }

  @Post('test')
  test() {
    return this.email.sendTestEmail()
  }
}


@Controller('notifications/email/oauth')
export class EmailOAuthController {
  constructor(private readonly email: EmailAutomationService) {}

  @Get('client-metadata')
  clientMetadata() {
    return this.email.oauthClientMetadata()
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() response: Response,
  ) {
    try {
      await this.email.completeOAuth(code, state)
      return response.redirect(
        this.email.frontendResultUrl('success'),
      )
    } catch {
      return response.redirect(
        this.email.frontendResultUrl('error'),
      )
    }
  }
}
