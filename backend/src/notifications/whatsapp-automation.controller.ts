import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { WhatsAppAutomationService } from './whatsapp-automation.service'

@Controller('admin/notifications/whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class WhatsAppAutomationController {
  constructor(private readonly whatsapp: WhatsAppAutomationService) {}

  @Get('status')
  status() {
    return this.whatsapp.status()
  }

  @Get('outbox')
  outbox(@Query('limit') limit = '50') {
    const parsed = Number.parseInt(limit, 10)
    return this.whatsapp.recent(Number.isFinite(parsed) ? parsed : 50)
  }

  @Post('process')
  process() {
    return this.whatsapp.processNow()
  }
}
