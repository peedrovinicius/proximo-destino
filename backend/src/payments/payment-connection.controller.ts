import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ADMIN_ONLY_ROLES } from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { PaymentConnectionService } from './payment-connection.service'

@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY_ROLES)
export class PaymentConnectionAdminController {
  constructor(private readonly payments: PaymentConnectionService) {}

  @Get('mercado-pago')
  status() {
    return this.payments.status()
  }

  @Post('mercado-pago/platform')
  configurePlatform(
    @Body()
    input: {
      clientId: string
      clientSecret: string
      webhookSecret: string
    },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.configurePlatform(input, request.user.id)
  }

  @Post('mercado-pago/connect')
  connect(@Req() request: AuthenticatedRequest) {
    return this.payments.begin(request.user.id)
  }

  @Post('mercado-pago/disconnect')
  disconnect(@Req() request: AuthenticatedRequest) {
    return this.payments.disconnect(request.user.id)
  }
}

@Controller('payments/mercado-pago/oauth')
export class PaymentOAuthController {
  constructor(private readonly payments: PaymentConnectionService) {}

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() response: Response,
  ) {
    try {
      await this.payments.complete(code, state)
      return response.redirect(this.payments.frontendResultUrl('success'))
    } catch {
      return response.redirect(this.payments.frontendResultUrl('error'))
    }
  }
}
