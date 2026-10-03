import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ADMIN_ONLY_ROLES } from '../auth/role-capabilities'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
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

  @Get('outbox')
  outbox(@Query('limit') limit = '50') {
    const parsed = Number.parseInt(limit, 10)
    return this.email.recent(Number.isFinite(parsed) ? parsed : 50)
  }

  @Post('process')
  process() {
    return this.email.processNow()
  }
}
