import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { AdminNotificationsService } from './admin-notifications.service'

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.FINANCE)
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit = '80',
  ) {
    const parsed = Number.parseInt(limit, 10)
    return this.notifications.list(
      request.user.id,
      Number.isFinite(parsed) ? parsed : 80,
    )
  }

  @Patch(':id/read')
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(request.user.id, id)
  }

  @Post('read-all')
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.user.id)
  }
}
